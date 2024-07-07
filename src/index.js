
import { DurableObject } from "cloudflare:workers";

import Anthropic from '@anthropic-ai/sdk';

import homeHtml from "./html/index.html";
import conceptFieldPairs from "./concept_field_pairs";

// 94.28

const Commands = {
	GENERATE: 'generate',
	GENERATE_STARTED: 'generate-started',
	GENERATE_DONE: 'generate-done',
}

const Difficulties = {
	EASY: 'easy',
	NORMAL: 'normal',
	HARD: 'hard',
}

const Prompts = {
	CREATE_TRIVIA: `Please create 2 to 5 short trivia sentences related to the concept of "{{CONCEPT}}" within the field of study, {{FIELD_OF_STUDY}}. The trivia sentences should be factual and humorous, bizarre, or otherwise interesting.`,

	GENERATE_PRESENTATION: `Please create an interesting, factual, and engaging presentation on the concept of "{{CONCEPT}}" within the field of {{FIELD_OF_STUDY}}. The presentation should include 6 slides, starting with a title slide and ending with a conclusion slide. Each slide should contain concise, markdown-formatted textual content to be displayed to the audience, along with the exact narration that should accompany each slide. 

Key points for the presentation:
1. **Title Slide:** Introduce the presentation and yourself as Professor Noodle.
2. **Content Slides:** Present the concept in a clear, structured manner.
3. **Conclusion Slide:** Summarize the key points of the presentation.

Additionally, the presentation should include 5 test questions of increasing difficulty to assess the audience's understanding. These questions should be fully answerable by paying attention to the presentation, without requiring any outside knowledge. Each question should have a brief and concise answer.

{{DIFFICULTY_SNIPPET}}

---

### Example Slide Structure and Narration:

**Slide 1: Title Slide**
- Text Content: 
  \`\`\`
  # {{CONCEPT}}
  ### An Introduction by Professor Noodle
  \`\`\`
- Narration: 
  \`\`\`
  "Hello, everyone! I'm Professor Noodle, and today we're going to explore the fascinating concept of {{CONCEPT}} within the field of {{FIELD_OF_STUDY}}. Let's dive in! Over the next few slides, we'll unravel the intricacies of this concept, examine its relevance, and discover its practical applications. By the end of this presentation, you'll have a solid understanding of {{CONCEPT}} and its significance."
  \`\`\`

**Slide 2: Introduction to {{CONCEPT}}**
- Text Content: 
  \`\`\`
  ## What is {{CONCEPT}}?
  {{Brief description of the concept}}
  \`\`\`
- Narration: 
  \`\`\`
  "To start, let's understand what {{CONCEPT}} is. {{Provide a brief explanation of the concept}}. For instance, imagine how this concept plays out in real-world scenarios or everyday situations. It's crucial to grasp the basics because this foundation will help us explore the more complex aspects as we progress."
  \`\`\`

**Slide 3-5: Detailed Explanation**
- Text Content Example: 
  \`\`\`
  ## Key Aspects of {{CONCEPT}}
  - Point 1: {{Explanation}}
  - Point 2: {{Explanation}}
  - Point 3: {{Explanation}}
  \`\`\`
- Narration Example: 
  \`\`\`
  "Now, let's look at some key aspects of {{CONCEPT}}. First, {{Explain Point 1}}. This aspect is particularly intriguing because it highlights {{provide detailed information, including anecdotes or interesting trivia}}. For example, did you know that {{relevant trivia}}?

  Next, {{Explain Point 2}}. This point is crucial as it demonstrates {{detailed explanation with examples of utility or relevance}}. Consider how this aspect influences {{relevant field or practical application}}. An interesting case is {{provide an anecdote or example}}.

  Lastly, {{Explain Point 3}}. This aspect ties everything together by {{detailed explanation and additional context}}. It’s fascinating to see how {{Point 3}} impacts the overall understanding of {{CONCEPT}}. A relevant example is {{provide detailed example or trivia}}."
  \`\`\`

**Slide 6: Conclusion**
- Text Content: 
  \`\`\`
  ## Conclusion
  ### Recap of {{CONCEPT}}
  - Key Point 1
  - Key Point 2
  - Key Point 3
  \`\`\`
- Narration: 
  \`\`\`
  "To wrap up, let's recap what we've learned about {{CONCEPT}}. We've covered {{Key Point 1}}, delving into its core aspects and how it applies to {{FIELD_OF_STUDY}}. We also explored {{Key Point 2}}, providing a deeper understanding through examples and detailed explanations. Finally, we examined {{Key Point 3}}, connecting the dots and illustrating the broader implications of {{CONCEPT}}. Great job following along! Remember, the nuances and details we've discussed are what truly bring the concept to life."
  \`\`\`

### Example Test Questions:

1. **Easy Question:** 
   - **Question:** "What is the basic definition of {{CONCEPT}}?"

2. **Moderate Question:**
   - **Question:** "Name one key aspect of {{CONCEPT}} discussed in the presentation."

3. **Moderate Question:**
   - **Question:** "How does {{CONCEPT}} impact the field of {{FIELD_OF_STUDY}}?"

4. **Difficult Question:**
   - **Question:** "Describe the relationship between {{Point 1}} and {{Point 2}} within the context of {{CONCEPT}}."

5. **Challenging Question:**
   - **Question:** "Summarize the main points covered in the conclusion of the presentation."
`,
}

const Schema = {
	CREATE_TRIVIA: {
		type: 'object',
		description: 'Humorous, bizarre, or otherwise interesting trivia related to the concept',
		properties: {
			trivia: {
				type: 'array',
				description: 'Humorous, bizarre, or otherwise interesting trivia related to the concept',
				items: {
					type: 'string',
					description: 'A single short trivia sentence'
				}
			},
		},
		required: ['trivia']
	},
	GENERATE_PRESENTATION: {
		type: 'object',
		description: 'A 6 slide presentation on the concept and its key aspects, with 5 test questions',
		properties: {
			slides: {
				type: 'array',
				description: '6 slides for presenting the concept including a title slide, introduction slide, 3 detailed explanation slides, and a conclusion slide.',
				items: {
					type: 'object',
					properties: {
						textContent: {
							type: 'string',
							description: 'Markdown-formatted text content shown in the slide. Should be very brief and to the point, without any images or links.'
						},
						narration: {
							type: 'string',
							description: 'The narration to be spoken when showing this slide. This should be continuous with the other slides.'
						}
					},
					description: 'A slide in the presentation that includes text shown on the slide and narration to be spoken when showing the slide.',
					required: ['textContent', 'narration']
				},
			},
			questions: {
				type: 'array',
				description: '5 test questions for the presentation in increasing difficulty, each answerable entirely with the presentation material.',
				items: {
					type: 'string',
					description: 'A question that may be answered directly by paying attention to the presentation.'
				}
			}
		},
		required: ['slides', 'questions']
	}
}


export class NoodleKnockerDurableObject extends DurableObject {
	counter = 0;
	difficulty = Difficulties.NORMAL;
	playerCount = 1;
	anthropic;
	ws;
	concept;
	fieldOfStudy;

	async fetch(request) {
		const webSocketPair = new WebSocketPair();
		const [client, server] = Object.values(webSocketPair);
		this.ctx.acceptWebSocket(server);
		this.ws = server;

		this.anthropic = new Anthropic({
			apiKey: this.env.ANTHROPIC_API_KEY
		});

		return new Response(null, {
			status: 101,
			webSocket: client,
		});
	}

	sendCmd(cmd, data) {
		console.log(cmd, data);
		this.ws.send(JSON.stringify({
			'cmd': cmd,
			...data
		}))
	}

	convertToolInput(response) {
		if (response.stop_reason == 'tool_use') {
			for (let i = 0; i < response.content.length; i++) {
				if (response.content[i].type == 'tool_use') {
					return response.content[i].input;
				} 
			}
		}
		throw new Error('Failed to convert tool input');
	}

	async handleGenerateConcept() {
		const conceptFieldIndex = Math.floor(Math.random() * conceptFieldPairs.length);
		this.fieldOfStudy = conceptFieldPairs[conceptFieldIndex][0];
		this.concept = conceptFieldPairs[conceptFieldIndex][1];
		console.log(this.concept, this.fieldOfStudy);
		let prompt = Prompts.CREATE_TRIVIA
			.replace(/{{CONCEPT}}/g, this.concept)
			.replace(/{{FIELD_OF_STUDY}}/g, this.fieldOfStudy);
		let response = await this.anthropic.messages.create({
			model: 'claude-3-5-sonnet-20240620',
			max_tokens: 1024,
			messages: [{
				role: 'user',
				content: prompt
			}],
			tools: [{
				name: 'create_trivia',
				description: 'Create 2 to 5 short trivia sentences related to the concept, ' + this.concept,
				input_schema: Schema.CREATE_TRIVIA
			}],
			tool_choice: { type: 'tool', name: 'create_trivia' },
		});
		console.log(response);
		this.sendCmd(Commands.GENERATE_STARTED, {
			concept: this.concept,
			fieldOfStudy: this.fieldOfStudy,
			trivia: this.convertToolInput(response).trivia
		});

		let difficultSnippet = '**Important:** The presentation should be clear and understandable, targeting relatively uneducated adults new to the material. Ensure that the test questions are appropriate for this audience, ranging from easy to moderately challenging.';
		if (this.difficulty === Difficulties.EASY) {
			difficultSnippet = '**Important:** The presentation should be simple and very easy to understand, suitable for middle-school students new to the material. Ensure that the test questions are appropriate for this audience and are not particularly challenging.';
		} else if (this.difficulty === Difficulties.HARD) {
			difficultSnippet = '**Important:** The presentation should be advanced, fast-paced, and presume a highly intelligent and engaged audience. Ensure that the test questions are challenging, requiring the audience to pay very careful attention and reason logically about the material, but do not require any specialized knowledge outside of the presentation.';
		}
		prompt = Prompts.GENERATE_PRESENTATION
			.replace(/{{CONCEPT}}/g, this.concept)
			.replace(/{{FIELD_OF_STUDY}}/g, this.fieldOfStudy)
			.replace(/{{DIFFICULTY_SNIPPET}}/g, difficultSnippet);
		response = await this.anthropic.messages.create({
			model: 'claude-3-5-sonnet-20240620',
			max_tokens: 4096,
			system: 'You are Professor Noodle, an excellent communicator and presenter who is an expert on ' + this.concept + ' in the field of ' + this.fieldOfStudy + '.',
			messages: [{
				role: 'user',
				content: prompt
			}],
			tools: [{
				name: 'generate_presentation',
				description: 'Create a 6-slide presentation accompanied by 5 test questions on the concept, ' + this.concept,
				input_schema: Schema.GENERATE_PRESENTATION
			}],
			tool_choice: { type: 'tool', name: 'generate_presentation' },
		});
		console.log(response);
		this.sendCmd(Commands.GENERATE_DONE, this.convertToolInput(response));
	}


	async webSocketMessage(ws, message) {
		console.log("Message", message);
		try {
			var jsonData = JSON.parse(message);
			console.log(jsonData.cmd);
			if (jsonData.cmd === Commands.GENERATE) {
				this.difficulty = jsonData.difficulty;
				this.playerCount = jsonData.playerCount;
				await this.handleGenerateConcept();
			} else if (data.event === "close") {
				console.log("Close", data);
				ws.close();
			}
		} catch (err) {
			console.error(err);
		}
	}

	async webSocketClose(ws, code, reason, wasClean) {
		ws.close(1000, "Closing WebSocket");
	}

}

export default {

	async fetch(request, env, ctx) {
		try {
			const url = new URL(request.url);
			if (url.pathname === "/") {
				return new Response(homeHtml, { headers: { 'content-type': 'text/html' } });
			} else if (url.pathname == "/ws") {
				const upgradeHeader = request.headers.get('Upgrade');
				if (!upgradeHeader || upgradeHeader !== 'websocket') {
					return new Response('Expected Upgrade: websocket', { status: 426 });
				}	
				const id = env.NOODLE_KNOCKER_DURABLE_OBJECT.newUniqueId();
				const stub = env.NOODLE_KNOCKER_DURABLE_OBJECT.get(id);
				return stub.fetch(request);
			} else {
				return new Response("Not found.", { 
					status: 404,
					headers: { 'content-type': 'text/plain' }
				});				
			}
		} catch (e) {
			console.error(e);
			return new Response(e, { 
				status: 500,
				headers: { 'content-type': 'text/plain' }
			});
		}
	},
};
