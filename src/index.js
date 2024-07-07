
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
	CREATE_TRIVIA: 'Please create 2 to 5 short trivia sentences related to the concept "{{CONCEPT}}" within the field of study, {{FIELD_OF_STUDY}}. The trivia sentences should be factual and humorous, bizarre, or otherwise interesting.',
}

const Schema = {
	CREATE_TRIVIA: {
		type: 'object',
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
		description: 'Humorous, bizarre, or otherwise interesting trivia related to the concept',
		required: ['trivia']
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
		const prompt = Prompts.CREATE_TRIVIA
			.replace(/{{CONCEPT}}/g, this.concept)
			.replace(/{{FIELD_OF_STUDY}}/g, this.fieldOfStudy);
		const response = await this.anthropic.messages.create({
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
