
import { DurableObject } from "cloudflare:workers";
import { Buffer } from 'node:buffer';

import Anthropic from '@anthropic-ai/sdk';

import { w3cwebsocket } from 'websocket';
import { Validator } from '@cfworker/json-schema';

import homeHtml from "./html/index.html";
import conceptFieldPairs from "./concept_field_pairs";
import { contestants, maleNames, femaleNames } from "./contestants";
import { waitingLoopMp3, silent5SecMp3, fanfareMp3 } from "./encoded_statics";

const Commands = {
	GENERATE: 'generate',
	GENERATE_STARTED: 'generate-started',
	GENERATE_DONE: 'generate-done',
	TTS: 'tts',
	SAY: 'say',
	STOP_GENERATING_SPEECH: 'stop-generating-speech',
	DONE_SPEAKING: 'done-speaking',
	START_TRANSCRIBING: 'start-transcribing',
	STOP_TRANSCRIBING: 'stop-transcribing',
	TRANSCRIBED: 'transcribed',
	TRANSCRIBE_DONE: 'transcribe-done',
	ASK_QUESTION: 'ask-question',
	ASK_QUESTION_ANSWER_PART: 'ask-question-answer-part',
	ASK_QUESTION_FINISHED: 'ask-question-finished',
	TEACH_CONTESTANT: 'teach-contestant',
	TEACH_CONTESTANT_ANSWER_PART: 'teach-contestant-answer-part',
	TEACH_CONTESTANT_FINISHED: 'teach-contestant-finished',
	CONTESTANT_QUIZ: 'contestant-quiz',
	CONTESTANT_QUIZ_ANSWER_PART: 'contestant-quiz-answer-part',
	CONTESTANT_QUIZ_FINISHED: 'contestant-quiz-finished',
	PROFESSOR_QUIZ: 'professor-quiz',
	PROFESSOR_QUIZ_ANSWER_PART: 'professor-quiz-answer-part',
	PROFESSOR_QUIZ_FINISHED: 'professor-quiz-finished',
}

const Difficulties = {
	EASY: 'easy',
	NORMAL: 'normal',
	HARD: 'hard',
}

const Speakers = {
	PLAYER1: 'player1',
	PLAYER2: 'player2',
	PLAYER3: 'player3',
	PLAYER4: 'player4',
	PROFESSOR: 'professor'
}

const PROFESSOR_VOICE = 'aura-athena-en';

const FEMALE_SPEAKER_VOICES = [
	'aura-asteria-en',
	'aura-luna-en',
	'aura-stella-en',
	'aura-hera-en'
];

const MALE_SPEAKER_VOICES = [
	'aura-angus-en',
	'aura-orion-en',
	'aura-perseus-en',
	'aura-orpheus-en',
	'aura-zeus-en',
	'aura-helios-en'
];

const Prompts = {
	CREATE_TRIVIA: `Please create 2 to 5 short trivia sentences related to the concept of "{{CONCEPT}}" within the field of study, {{FIELD_OF_STUDY}}. The trivia sentences should be humorous, bizarre, or otherwise interesting.`,

	GENERATE_PRESENTATION: `Please create an interesting, factual, and engaging presentation on the concept of "{{CONCEPT}}" within the field of {{FIELD_OF_STUDY}}. The presentation should include 6 slides, starting with a title slide and ending with a conclusion slide. Each slide should contain concise, markdown-formatted text content to be displayed to the audience, along with the exact narration that should accompany each slide. 

Typical presentation structure:
**Title Slide:** Introduce the presentation and yourself as Professor Noodle.
**Introduction Slide:** Provide an overview of the concept.
**4 Content Slides:** Present the concept in a clear, structured manner, investigating four key areas in a connected way that builds upon each pervious slide.
**Conclusion Slide:** Summarize the key points of the presentation and conclude with a thought-provoking or humorous conclusion.

Besides the Title Slide, each slide's text content should generally consist of a header showing the topic, followed by 3 to 5 unnumbered bullet points. The narration should not simply read the slide's text content, but expand and elaborate on it, adding examples, details, analogies, and other interesting information. The narration should be engaging, thought-provoking, and informative, with occasional humor or other attention-holding elements. 

Additionally, the presentation should include 5 test questions of increasing difficulty to assess the audience's understanding. These questions should be fully answerable by paying attention to the presentation, without requiring any outside knowledge. Each question should have a brief and concise answer.

The presentation will take about 3 minutes to present.

**All information in the presentation should be factual (except for obvious jokes and puns)!**

{{DIFFICULTY_SNIPPET}}
`,

	SYSTEM_GENERATE_PRESENTATION: `You are Professor Noodle, an excellent communicator and presenter who is an expert on {{CONCEPT}} in the field of {{FIELD_OF_STUDY}}.`,

	SYSTEM_ASK_QUESTION: `You are Professor Noodle, a skilled speaker who is an expert on {{CONCEPT}} in the field of {{FIELD_OF_STUDY}}. You have just finished giving a short presentation on the concept of "{{CONCEPT}}" as part of a learning game called Noodle Knocker. The user has been invited to ask you questions related to the presentation. Please answer these questions in a very concise, clear, and conversational manner, primarily using the Presentation Transcript below but freely supplementing with additional factual information. Avoid directly quoting the presentation, but instead paraphrase or expand on its text as needed. If the user wants to ask a question that appears unrelated to {{CONCEPT}} or the presentation, try your best to guess or infer a relationship between their question and the presentation.
	
**Important:** Your responses should be limited to spoken content only. Don't include any non-verbal elements such as actions, emotes, or descriptions.

## Presentation Transcript

{{PRESENTATION_TRANSCRIPT}}`,

	SYSTEM_TEACH_ADDENDUM: `The user will be conversationally teaching you about {{CONCEPT}} in the field of {{FIELD_OF_STUDY}}. Restrict your knowledge about this topic to only what the user teaches you and what you might rasonably infer from your occupation. You are very curious about {{CONCEPT}}, and are a very fast learner good at understanding the user's intentions even when they are unclear or garbled. Ask clarifying questions if it's helpful to understanding the topic. Remember: the only knowledge you have about the topic is what the user teaches you!

**Important:** Your responses should be limited to spoken content only. Don't include any non-verbal elements such as actions, emotes, or descriptions. Keep your responses very short, clear, and conversational.`,

	SYSTEM_ANSWER_ADDENDUM: `The user will be asking you a question about {{CONCEPT}} in the field of {{FIELD_OF_STUDY}}. You must answer the question using *only* the information in the Teaching Conversation you had with {{PLAYER}} and what you might reasonably infer from your occupation. Answer only the question, and do not offer to discuss it further. Remember: the only knowledge you have about the topic is what {{PLAYER}} taught you!

**Important:** Your responses should be limited to spoken content only. Don't include any non-verbal elements such as actions, emotes, or descriptions. Keep your responses very short, clear, and conversational.

## Teaching Conversation

{{TEACHING_CONVERSATION}}`,

	SYSTEM_ANSWER_DUH_ADDENDUM: `The user will be asking you a question about {{CONCEPT}} in the field of {{FIELD_OF_STUDY}}. You must answer the question using *only* the information in a conversation you had with {{PLAYER}}. However, {{PLAYER}} didn't talk with you and so you didn't learn anything! Since you can only use the information from the conversation, you won't be able to answer the question, so instead make a humorous and obviously incorrect effort for laughs. 

**Important:** Your responses should be limited to spoken content only. Don't include any non-verbal elements such as actions, emotes, or descriptions. Keep your responses very short, clear, and conversational.`,

	SYSTEM_PROFESSOR_GRADES: `You are Professor Noodle, an expert on {{CONCEPT}} in the field of {{FIELD_OF_STUDY}}. You have given a presentation on the concept of "{{CONCEPT}}" as part of a learning game called Noodle Knocker. You are now tasked with grading the user's answer to a question about {{CONCEPT}} based on how well the answer reflects the information in the Presentation below. Give the grade verbally along with the reason for why you chose that grade. Keep your answer very short and to the point.

The grade you give should be an integer between 0 and 100 (higher is better). Answers that are largely incorrect or incomplete should receive a grade less than 25, and only good answers should receive a grade of 75 or higher. **Be sure to explain why you choose the grade you give.** 
	
{{DIFFICULTY_SNIPPET}}

**Important:** Your response should be limited to spoken content only. Don't include any non-verbal elements such as actions, emotes, or descriptions.

## Presentation

{{PRESENTATION_TRANSCRIPT}}`,

	PROFESSOR_GRADES: `Answer the following question and I will give you a grade between 0 and 100 along with an insightful reason for the grade: {{QUESTION}}`,

	EXTRACT_GRADE: `Based on the professor's response to a question's answer, extract or infer a grade between 0 and 100 (higher is better).\n**Professor's Response:** {{ANSWER}}`

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
		description: 'A 6 slide presentation on the concept with 5 related test questions',
		properties: {
			slides: {
				type: 'array',
				description: '6 slides for presenting the concept including a title slide, introduction slide, 3 detailed explanation slides, and a conclusion slide.',
				items: {
					type: 'object',
					properties: {
						textContent: {
							type: 'string',
							description: 'Markdown-formatted text content shown in the slide. Will typically be a header and 3 to 5 unnumbered bullet points.'
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
	},
	EXTRACT_GRADE: {
		type: 'object',
		description: 'The extracted grade between 0 and 100, with 100 being the highest grade',
		properties: {
			grade: {
				type: 'number',
				description: 'The extracted grade between 0 and 100, with 100 being the highest grade'
			}
		},
		required: ['grade']
	}
}


export class NoodleKnockerDurableObject extends DurableObject {
	counter = 0;
	difficulty = Difficulties.NORMAL;
	playerCount = 1;
	playerNames = [];
	anthropic;
	ws;
	concept;
	fieldOfStudy;
	clientIP;
	presentation;
	transcript = '';
	questions;
	professorVoice = PROFESSOR_VOICE;
	playerData = [];
	speakWs = null;
	speakBuffer = '';
	lastVoice;
	transcribeWs = null;
	qAndAMessages = [
		{
			role: 'user',
			content: 'Hello!'
		}, {
			role: 'assistant',
			content: 'Hello! Do you have any questions?'
		}
	];
	flushRequestedAt = 0;

	constructor(state, env) {
		super(state, env);
		console.log('Creating a new Durable Object...'); // xxx
	}

	async fetch(request) {
		this.clientIP = request.headers.get('cf-connecting-ip');
		if (!this.clientIP) {
			this.clientIP = 'localhost';
		}
		console.log('Connection from', this.clientIP);
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

	async sendCmd(cmd, data) {
		let attempts = 0;
		while (attempts < 40 && (this.ws === null || this.ws.readyState !== WebSocket.OPEN)) {
			attempts++;
			console.log('Waiting for WebSocket to be ready...');
			await new Promise(resolve => setTimeout(resolve, 500));
		}
		this.ws.send(JSON.stringify({
			'cmd': cmd,
			...data
		}))
	}

	async handleGenerateConcept() {
		this.playerData = [];
		let availableMaleVoices = MALE_SPEAKER_VOICES.slice();
		availableMaleVoices.sort(() => Math.random() - 0.5);
		let availableFemaleVoices = FEMALE_SPEAKER_VOICES.slice();
		availableFemaleVoices.sort(() => Math.random() - 0.5);
		for (let i = 0; i < this.playerCount; i++) {
			let gender;
			let voice;
			let name;
			if (Math.random() > 0.5) {
				gender = 'female';
				name = femaleNames[Math.floor(Math.random() * femaleNames.length)];
				voice = availableFemaleVoices.pop();
			} else {
				gender = 'male';
				name = maleNames[Math.floor(Math.random() * maleNames.length)];
				voice = availableMaleVoices.pop();
			}
			this.playerData.push({
				name: name,
				voice: voice,
				gender: gender,
				score: 0,
				answers: [],
				conversation: [],
				hexColor: Array.from({length: 3}, () => Math.floor(Math.random() * (256 - 120) + 120).toString(16).padStart(2, '0')).join(''),
				description: contestants[Math.floor(Math.random() * Object.keys(contestants).length)].replace(/{{NAME}}/g, name)
			});
		}
		let conceptFieldIndex = Math.floor(Math.random() * conceptFieldPairs.length);
		this.fieldOfStudy = conceptFieldPairs[conceptFieldIndex][0];
		this.concept = conceptFieldPairs[conceptFieldIndex][1];

		const artStyle = [
			"Cartoon",
			"Comic Book",
			"Street Art",
			"Pop Art",
			"Graffiti",
			"Digital Art",
			"Pixel Art",
			"Vaporwave",
			"Fantasy Art",
			"Chibi",
			"Manga",
			"Cyberpunk"
		][Math.floor(Math.random() * 12)];
		let prompt = `(${this.concept}), ${this.fieldOfStudy}, in a ${artStyle} style`;
		let imagePromise = await this.env.AI.run(
			"@cf/bytedance/stable-diffusion-xl-lightning",
			{
				prompt: prompt
			}
		);

		prompt = Prompts.CREATE_TRIVIA
			.replace(/{{CONCEPT}}/g, this.concept)
			.replace(/{{FIELD_OF_STUDY}}/g, this.fieldOfStudy);
		let response;
		let attempts = 0;
		let validator = new Validator(Schema.CREATE_TRIVIA);
		while (attempts < 3) {
			try {
				response = await this.anthropic.messages.create({
					model: this.env.ANTHROPIC_MODEL,
					max_tokens: 1024,
					messages: [{
						role: 'user',
						content: prompt
					}],
					tools: [{
						name: 'create_trivia',
						description: 'Create 2 to 5 short humorous trivia sentences related to the concept, ' + this.concept,
						input_schema: Schema.CREATE_TRIVIA
					}],
					tool_choice: { type: 'tool', name: 'create_trivia' },
				});
				if (typeof response.content[0].input === 'string') {
					response.content[0].input = JSON.parse(response.content[0].input);
				}
				if (validator.validate(response.content[0].input).valid) {
					break;
				} else {
					console.error(validator.validate(response.content[0].input).errors);
					attempts++;
				}
			} catch (e) {
				console.error(e);
				attempts++;
			}
			await new Promise(resolve => setTimeout(resolve, 1000 * attempts));  // mitigate 529 errors (overloads), etc
		}
		if (attempts === 3) {
			console.error('Failed to generate trivia');
			console.log(this);
			this.sendCmd(Commands.GENERATE_STARTED, {
				concept: this.concept,
				fieldOfStudy: this.fieldOfStudy,
				trivia: ['Generating...']
			});
		} else {
			console.log(response);
			this.sendCmd(Commands.GENERATE_STARTED, {
				concept: this.concept,
				fieldOfStudy: this.fieldOfStudy,
				trivia: response.content[0].input.trivia
			});
		}

		let difficultySnippet = '**Important:** The presentation should be clear and understandable, targeting relatively uneducated adults new to the material. Ensure that the test questions are appropriate for this audience, ranging from easy to moderately challenging.';
		if (this.difficulty === Difficulties.EASY) {
			difficultySnippet = '**Important:** The presentation should be simple and very easy to understand, suitable for middle-school students new to the material. Ensure that the test questions are appropriate for this audience and are not particularly challenging.';
		} else if (this.difficulty === Difficulties.HARD) {
			difficultySnippet = '**Important:** The presentation should be advanced, fast-paced, and presume a highly intelligent and engaged audience. Ensure that the test questions are challenging, requiring the audience to pay very careful attention and reason logically about the material, but do not require any specialized knowledge outside of the presentation.';
		}
		prompt = Prompts.GENERATE_PRESENTATION
			.replace(/{{CONCEPT}}/g, this.concept)
			.replace(/{{FIELD_OF_STUDY}}/g, this.fieldOfStudy)
			.replace(/{{DIFFICULTY_SNIPPET}}/g, difficultySnippet);
		attempts = 0;
		validator = new Validator(Schema.GENERATE_PRESENTATION);
		while (attempts < 3) {
			try {
				response = await this.anthropic.messages.create({
					model: this.env.ANTHROPIC_MODEL,
					max_tokens: 4096,
					system: Prompts.SYSTEM_GENERATE_PRESENTATION
						.replace(/{{CONCEPT}}/g, this.concept)
						.replace(/{{FIELD_OF_STUDY}}/g, this.fieldOfStudy),
					messages: [{
						role: 'user',
						content: prompt
					}],
					tools: [{
						name: 'generate_presentation',
						description: 'Create a 6-slide presentation with 5 test questions on the concept, ' + this.concept,
						input_schema: Schema.GENERATE_PRESENTATION
					}],
					tool_choice: { type: 'tool', name: 'generate_presentation' },
				});
				if (typeof response.content[0].input === 'string') {
					response.content[0].input = JSON.parse(response.content[0].input);
				}
				if (validator.validate(response.content[0].input).valid) {
					break;
				} else {
					console.error(validator.validate(response.content[0].input).errors);
					attempts++;
				}
			} catch (e) {
				console.error(e);
				attempts++;
			}
			await new Promise(resolve => setTimeout(resolve, 2000 * attempts));
		}
		if (attempts === 3) {
			console.error('Failed to generate presentation');
			throw new Error('Failed to generate presentation');
		}
		console.log(response);
		this.presentation = response.content[0].input;

		this.transcript = '';
		this.presentation.slides.forEach(slide => {
			this.transcript += slide.narration + '\n';
		});

		response = await imagePromise;
		let reader = await response.getReader();
		const chunks = [];
		let done, value;
		while (!done) {
			({ done, value } = await reader.read());
			if (value) {
				chunks.push(value);
			}
		}

		function uint8ToBase64(uint8Array) {
			const CHUNK_SIZE = 0x8000;
			let base64 = '';
			for (let i = 0; i < uint8Array.length; i += CHUNK_SIZE) {
				const chunk = uint8Array.subarray(i, i + CHUNK_SIZE);
				base64 += String.fromCharCode.apply(null, chunk);
			}
			return btoa(base64);
		}

		const combinedChunks = new Uint8Array(chunks.reduce((acc, chunk) => acc + chunk.length, 0));
		let offset = 0;
		for (const chunk of chunks) {
			combinedChunks.set(chunk, offset);
			offset += chunk.length;
		}

		const base64Image = 'data:image/png;base64,' + uint8ToBase64(combinedChunks);

		const playerDataWithoutVoice = this.playerData.map(player => {
			const { voice, ...rest } = player;
			return rest;
		});
		
		this.sendCmd(Commands.GENERATE_DONE, {
			presentation: this.presentation,
			playerData: playerDataWithoutVoice,
			base64Image: base64Image
		});
	}

	
	splitFirstSentence(text) {
		const index = text.search(/[.?!]/);
		if (index === -1) {
			return ['', text];
		} else {
			return [text.substring(0, index + 1), text.substring(index + 1)];
		}
	}

	async handleAskQuestion(question) {
		this.qAndAMessages.push({ role: 'user', content: question });
		let answerBuffer = '';
		const stream = this.anthropic.messages.stream({
			model: this.env.ANTHROPIC_MODEL,
			max_tokens: 1024,
			system: Prompts.SYSTEM_ASK_QUESTION
				.replace(/{{CONCEPT}}/g, this.concept)
				.replace(/{{FIELD_OF_STUDY}}/g, this.fieldOfStudy)
				.replace(/{{PRESENTATION_TRANSCRIPT}}/g, this.transcript),
			messages: this.qAndAMessages
		}).on('text', (text) => {
			answerBuffer += text;
			const [firstSentence, remainder] = this.splitFirstSentence(answerBuffer);
			if (firstSentence.trim()) {
				this.speak(firstSentence, Speakers.PROFESSOR);
				this.sendCmd(Commands.ASK_QUESTION_ANSWER_PART, {
					text: firstSentence
				});
				answerBuffer = remainder;
			}
		}).on('finalMessage', (message) => {
			try {
				if (answerBuffer.trim()) {
					this.speak(answerBuffer, Speakers.PROFESSOR);
					this.sendCmd(Commands.ASK_QUESTION_ANSWER_PART, {
						text: answerBuffer
					});
				}
				this.qAndAMessages.push({ role: 'assistant', content: message.content[0].text });
				this.finishSpeaking();
				this.sendCmd(Commands.ASK_QUESTION_FINISHED, {});
			} catch (e) {
				console.error(e);
			}
		});
	}

	async handleTeachContestant(playerIndex, text) {
		let speaker = Speakers.PLAYER1;
		if (playerIndex === 0) {
			speaker = Speakers.PLAYER1;
		} else if (playerIndex === 1) {
			speaker = Speakers.PLAYER2;
		} else if (playerIndex === 2) {
			speaker = Speakers.PLAYER3;
		} else if (playerIndex === 3) {
			speaker = Speakers.PLAYER4;
		}
		this.playerData[playerIndex].conversation.push({ role: 'user', content: text });
		let answerBuffer = '';
		const prompt = this.playerData[playerIndex].description + '\n\n' + Prompts.SYSTEM_TEACH_ADDENDUM
			.replace(/{{CONCEPT}}/g, this.concept)
			.replace(/{{FIELD_OF_STUDY}}/g, this.fieldOfStudy);
		
		const stream = this.anthropic.messages.stream({
			model: this.env.ANTHROPIC_MODEL,
			max_tokens: 1024,
			system: prompt,
			messages: this.playerData[playerIndex].conversation
		}).on('text', (text) => {
			answerBuffer += text;
			const [firstSentence, remainder] = this.splitFirstSentence(answerBuffer);
			if (firstSentence.trim()) {
				this.speak(firstSentence, speaker);
				this.sendCmd(Commands.TEACH_CONTESTANT_ANSWER_PART, {
					speaker: speaker,
					text: firstSentence
				});
				answerBuffer = remainder;
			}
		}).on('finalMessage', (message) => {
			try {
				if (answerBuffer.trim()) {
					this.speak(answerBuffer, speaker);
					this.sendCmd(Commands.TEACH_CONTESTANT_ANSWER_PART, {
						speaker: speaker,
						text: answerBuffer
					});
				}
				this.playerData[playerIndex].conversation.push({ role: 'assistant', content: message.content[0].text });
				this.finishSpeaking();
				this.sendCmd(Commands.TEACH_CONTESTANT_FINISHED, {});
			} catch (e) {
				console.error(e);
			}
		}).on('error', (e) => {
			console.error(e);
		});
	}

	async handleContestantAnswers(playerIndex, questionIndex) {
		let speaker = Speakers.PLAYER1;
		if (playerIndex === 0) {
			speaker = Speakers.PLAYER1;
		} else if (playerIndex === 1) {
			speaker = Speakers.PLAYER2;
		} else if (playerIndex === 2) {
			speaker = Speakers.PLAYER3;
		} else if (playerIndex === 3) {
			speaker = Speakers.PLAYER4;
		}
		try {
		let answerBuffer = '';
		const rawConversation = this.playerData[playerIndex].conversation;
		let prompt;
		if (rawConversation.length > 2) {
			let teachingConversation = '';
			for (let i = 1; i < rawConversation.length; i++) {
				if (i % 2 === 1) {
					teachingConversation += `**You:** ${rawConversation[i].content}\n\n`;
				} else {
					teachingConversation += `**${this.playerNames[playerIndex]}:** ${rawConversation[i].content}\n\n`;
				}
			}
			prompt = this.playerData[playerIndex].description + '\n\n' + Prompts.SYSTEM_ANSWER_ADDENDUM
				.replace(/{{CONCEPT}}/g, this.concept)
				.replace(/{{FIELD_OF_STUDY}}/g, this.fieldOfStudy)
				.replace(/{{PLAYER}}/g, this.playerNames[playerIndex])
				.replace(/{{TEACHING_CONVERSATION}}/g, teachingConversation);
		} else {
			prompt = this.playerData[playerIndex].description + '\n\n' + Prompts.SYSTEM_ANSWER_DUH_ADDENDUM
				.replace(/{{CONCEPT}}/g, this.concept)
				.replace(/{{FIELD_OF_STUDY}}/g, this.fieldOfStudy)
				.replace(/{{PLAYER}}/g, this.playerNames[playerIndex])
		}
		
		const stream = this.anthropic.messages.stream({
			model: this.env.ANTHROPIC_MODEL,
			max_tokens: 512,
			system: prompt,
			messages: [{
				role: 'user',
				content: this.presentation.questions[questionIndex]
			}]
		}).on('text', (text) => {
			answerBuffer += text;
			const [firstSentence, remainder] = this.splitFirstSentence(answerBuffer);
			if (firstSentence.trim()) {
				this.speak(firstSentence, speaker);
				this.sendCmd(Commands.CONTESTANT_QUIZ_ANSWER_PART, {
					speaker: speaker,
					text: firstSentence
				});
				answerBuffer = remainder;
			}
		}).on('finalMessage', (message) => {
			try {
				if (answerBuffer.trim()) {
					this.speak(answerBuffer, speaker);
					this.sendCmd(Commands.CONTESTANT_QUIZ_ANSWER_PART, {
						speaker: speaker,
						text: answerBuffer
					});
				}
				this.playerData[playerIndex].answers.push(message.content[0].text);
				this.finishSpeaking();
				this.sendCmd(Commands.CONTESTANT_QUIZ_FINISHED, {});
			} catch (e) {
				console.error(e);
			}
		}).on('error', (e) => {
			console.error(e);
		});
		} catch (e) {
			console.error(e);
		}
	}

	async handleProfessorGrades(playerIndex, questionIndex) {
		try {
		let answerBuffer = '';
		let difficultySnippet = 'The grade you give should be generous and lenient, as the user is a beginner in their studies. Be encouraging and positive in your reason for the grade.';
		if (this.difficulty === Difficulties.EASY) {
			difficultySnippet = 'The grade you give should be fair, with a thoughtful reason. The user is a lay person and should only be graded based on the information in the Presentation Transcript not on any additional knowledge you did not discuss in the presentation.';
		} else if (this.difficulty === Difficulties.HARD) {
			difficultySnippet = 'The grade you give should strictly be based on the information in the Presentation Transcript. Be fair and provide a thoughtful reason. Penalize incorrect or incomplete answers, but allow for the fact that the user was only allowed to provide a very short answer. If the user did poorly, you may humorously call out their mistakes, but do not engage in any ad hominem insults or rude behavior.';
		}
		let prompt = Prompts.SYSTEM_PROFESSOR_GRADES
			.replace(/{{CONCEPT}}/g, this.concept)
			.replace(/{{FIELD_OF_STUDY}}/g, this.fieldOfStudy)
			.replace(/{{DIFFICULTY_SNIPPET}}/g, difficultySnippet)
			.replace(/{{PRESENTATION_TRANSCRIPT}}/g, this.transcript);
		const stream = this.anthropic.messages.stream({
			model: this.env.ANTHROPIC_MODEL,
			max_tokens: 512,
			system: prompt,
			messages: [{
				role: 'user',
				content: 'I am ready to be graded from 0 to 100 based on understanding the Presentation Transcript.'
			},
			{
				role: 'assistant',
				content: 'Your question is: ' + this.presentation.questions[questionIndex]
			},
			{
				role: 'user',
				content: this.playerData[playerIndex].answers[questionIndex]
			},]
		}).on('text', (text) => {
			answerBuffer += text;
			const [firstSentence, remainder] = this.splitFirstSentence(answerBuffer);
			if (firstSentence.trim()) {
				this.speak(firstSentence, Speakers.PROFESSOR);
				this.sendCmd(Commands.PROFESSOR_QUIZ_ANSWER_PART, {
					speaker: Speakers.PROFESSOR,
					text: firstSentence
				});
				answerBuffer = remainder;
			}
		}).on('finalMessage', async (message) => {
			try {
				if (answerBuffer.trim()) {
					this.speak(answerBuffer, Speakers.PROFESSOR);
					this.sendCmd(Commands.PROFESSOR_QUIZ_ANSWER_PART, {
						speaker: Speakers.PROFESSOR,
						text: answerBuffer
					});
				}
				const answer = message.content[0].text;
				let grade = 0;
				const match = answer.match(/\b(100|\d{1,2})\b/)
				if (match) {
					grade = parseInt(match[0]);
				} else {
					let validator = new Validator(Schema.EXTRACT_GRADE);
					prompt = Prompts.EXTRACT_GRADE
						.replace(/{{ANSWER}}/g, answer);
					response = await this.anthropic.messages.create({
						model: this.env.ANTHROPIC_MODEL,
						max_tokens: 64,
						messages: [{
							role: 'user',
							content: prompt
						}],
						tools: [{
							name: 'extract_grade',
							description: 'Extracts or infers a grade between 0 and 100',
							input_schema: Schema.EXTRACT_GRADE
						}],
						tool_choice: { type: 'tool', name: 'extract_grade' },
					});
					if (typeof response.content[0].input === 'string') {
						response.content[0].input = JSON.parse(response.content[0].input);
					}
					if (validator.validate(response.content[0].input).valid) {
						grade = response.content[0].input.grade;
					} else {
						grade = 0;
					}
				}
				this.playerData[playerIndex].score += grade;
				this.finishSpeaking();
				this.sendCmd(Commands.PROFESSOR_QUIZ_FINISHED, {
					grade: grade,
					playerIndex: playerIndex
				});
			} catch (e) {
				console.error(e);
			}
		}).on('error', (e) => {
			console.error(e);
		});
		} catch (e) {
			console.error(e);
		}
	}

	getVoice(speaker) {
		if (speaker === Speakers.PROFESSOR) {
			return this.professorVoice;
		} else if (speaker === Speakers.PLAYER1) {
			return  this.playerData[0].voice;
		} else if (speaker === Speakers.PLAYER2) {
			return  this.playerData[1].voice;
		} else if (speaker === Speakers.PLAYER3) {
			return  this.playerData[2].voice;
		} else if (speaker === Speakers.PLAYER4) {
			return this.playerData[3].voice;
		} else {
			return this.professorVoice;
		}
	}

	async speak(text, speaker, isOneShot = false) {
		if (text.length === 0) {
			return;
		}
		let newVoice = this.getVoice(speaker);

		if (newVoice !== this.lastVoice || this.speakWs === null) {
			this.speakBuffer = text;
			if (this.speakWs !== null) {
				this.speakWs.close();
			}
			this.lastVoice = newVoice;
			try {
				this.speakWs = new w3cwebsocket(this.env.DEEPGRAM_SPEAK_ENDPOINT + `?model=${newVoice}&encoding=mp3`,["token", this.env.DEEPGRAM_API_KEY]);
				const target = this;
				this.speakWs.onopen = function (event) {
				};
				this.speakWs.onmessage = function (event) {
					if (typeof event.data !== 'string') {
						if (event.data.byteLength > 0) {
							target.ws.send(event.data);						
						}
					} else {
						const jsonData = JSON.parse(event.data);
						if (jsonData.type === 'Metadata') {
							// remove emotes from speech -- rarely necessary with sonnet 3.5+
							let text = target.speakBuffer.replace(/\*([^*\s][^*]*?\s[^*]*?)\*/g, '');
							target.speakWs.send(JSON.stringify({
								type: 'Speak',
								text: text
							}));
							if (isOneShot) {
								target.speakWs.send(JSON.stringify({
									type: 'Flush'
								}));									
							}
							target.speakBuffer = '';
						} else if (jsonData.type === 'Flushed') {
							target.flushRequestedAt = 0;
							target.sendCmd(Commands.DONE_SPEAKING, {});
						}
					}
				};
				this.speakWs.onerror = function (event) {
					console.error(event);
				};
				this.speakWs.onclose = function (event) {
				}
			} catch (err) {
				console.error(err);
			}
		} else {
			if (this.speakWs !== null && this.speakWs.readyState === WebSocket.OPEN) {
				this.speakWs.send(JSON.stringify({
					type: 'Speak',
					text: text.replace(/\*([^*\s][^*]*?\s[^*]*?)\*/g, '')
				}));
				if (isOneShot) {
					this.speakWs.send(JSON.stringify({
						type: 'Flush'
					}));				
				}
			} else {
				this.speakBuffer += text;
			}	
		}
	}

	finishSpeaking() {
		function checkFlush() {
			const delta = Date.now() - this.flushRequestedAt;
			if (delta > 300 && delta < 700) {
				this.sendCmd(Commands.DONE_SPEAKING, {});
				this.flushRequestedAt = 0;
			}
		};
		if (this.speakWs !== null && this.speakWs.readyState === WebSocket.OPEN) {
			this.flushRequestedAt = Date.now();
			setTimeout(checkFlush, 500);
			this.speakWs.send(JSON.stringify({
				type: 'Flush'
			}));
		} else {
			setTimeout(() => {
				if (this.speakWs !== null && this.speakWs.readyState === WebSocket.OPEN) {
					this.flushRequestedAt = Date.now();
					setTimeout(checkFlush, 500);
					this.speakWs.send(JSON.stringify({
						type: 'Flush'
					}));						
				} else {
					console.error('speakWs is null or not open');
				}
			}, 250);
		}
	}

	startTranscribing(sampleRate) {
		if (this.transcribeWs !== null) {
			this.transcribeWs.close();
			this.transcribeWs = null;
		}
		try {
			this.transcribeWs = new w3cwebsocket(this.env.DEEPGRAM_TRANSCRIBE_ENDPOINT + `?encoding=linear16&sample_rate=${sampleRate}&smart_format=true`,["token", this.env.DEEPGRAM_API_KEY]);
			const target = this;
			this.transcribeWs.onopen = function (event) {
			};
			this.transcribeWs.onmessage = function (event) {
				const jsonData = JSON.parse(event.data);
				console.log(jsonData);
				if (jsonData.type === 'Results') {
					const text = jsonData.channel.alternatives[0].transcript;
					if (text.length > 0) {
						target.sendCmd(Commands.TRANSCRIBED, {
							text: text
						});							
					}
				}
			};
			this.transcribeWs.onerror = function (event) {
				console.error(event);
			};
			this.transcribeWs.onclose = function (event) {
				target.sendCmd(Commands.TRANSCRIBE_DONE, {});
				this.transcribeWs = null;
			}
		} catch (err) {
			console.error(err);
		}
	}

	stopTranscribing() {
		if (this.transcribeWs !== null) {
			this.transcribeWs.send(JSON.stringify({
				type: 'CloseStream'
			}));
		}		
	}


	async webSocketMessage(ws, message) {
		if (typeof message !== 'string') {
			if (this.transcribeWs !== null && this.transcribeWs.readyState === WebSocket.OPEN) {
				this.transcribeWs.send(message);
			}
		} else {
			try {
				var jsonData = JSON.parse(message);
				console.log(jsonData.cmd, 'received');
				if (jsonData.cmd === Commands.GENERATE) {
					this.difficulty = jsonData.difficulty;
					this.playerCount = jsonData.playerCount;
					this.playerNames = jsonData.playerNames;
					await this.handleGenerateConcept();
				} else if (jsonData.cmd === Commands.TTS) {
					this.speak(jsonData.text, jsonData.speaker, true);
				} else if (jsonData.cmd === Commands.STOP_GENERATING_SPEECH) {
					if (this.speakWs) {
						this.speakWs.send(JSON.stringify({
							type: 'Reset'
						}));
					}
				} else if (jsonData.cmd === Commands.START_TRANSCRIBING) {
					this.startTranscribing(jsonData.sampleRate);
				} else if (jsonData.cmd === Commands.STOP_TRANSCRIBING) {
					this.stopTranscribing();
				} else if (jsonData.cmd === Commands.ASK_QUESTION) {
					this.handleAskQuestion(jsonData.text);
				} else if (jsonData.cmd === Commands.TEACH_CONTESTANT) {
					this.handleTeachContestant(jsonData.playerIndex, jsonData.text);
				} else if (jsonData.cmd === Commands.CONTESTANT_QUIZ) {
					this.handleContestantAnswers(jsonData.playerIndex, jsonData.questionIndex);
				} else if (jsonData.cmd === Commands.PROFESSOR_QUIZ) {
					this.handleProfessorGrades(jsonData.playerIndex, jsonData.questionIndex);
				} else if (data.event === "close") {
					if (this.speakWs !== null) {
						this.speakWs.close();
						this.speakWs = null;
					}
					ws.close();
				}
			} catch (err) {
				console.error(err);
			}
		}
	}

	async webSocketClose(ws, code, reason, wasClean) {
		console.log('WebSocket closed', code, reason, wasClean); // xxx
		if (this.speakWs !== null) {
			this.speakWs.close();
			this.speakWs = null;
		}
		if (this.transcribeWs !== null) {
			this.transcribeWs.close();
			this.transcribeWs = null;
		}
		ws.close(1000, "Closing WebSocket");
	}

}

export default {

	async fetch(request, env, ctx) {
		try {
			const url = new URL(request.url);
			if (url.pathname === '/') {
				return new Response(homeHtml, { headers: { 'content-type': 'text/html' } });
			} else if (url.pathname === '/ws') {
				const upgradeHeader = request.headers.get('Upgrade');
				if (!upgradeHeader || upgradeHeader !== 'websocket') {
					return new Response('Expected Upgrade: websocket', { status: 426 });
				}
				const id = env.NOODLE_KNOCKER_DURABLE_OBJECT.newUniqueId();
				const stub = env.NOODLE_KNOCKER_DURABLE_OBJECT.get(id);
				console.log(stub); // xxx
				return stub.fetch(request);
			} else if (url.pathname === '/waiting-loop.mp3') {
				return new Response(Buffer.from(waitingLoopMp3, 'base64'), { headers: { 'content-type': 'audio/mpeg' } });
			} else if (url.pathname === '/silent.mp3') {
				return new Response(Buffer.from(silent5SecMp3, 'base64'), { headers: { 'content-type': 'audio/mpeg' } });
			} else if (url.pathname === '/fanfare.mp3') {
				return new Response(Buffer.from(fanfareMp3, 'base64'), { headers: { 'content-type': 'audio/mpeg' } });
			} else {
				return new Response('Not found.', {
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
