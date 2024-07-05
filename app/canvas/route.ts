import fs from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const MODEL_NAME = "claude-3-opus-20240229";

const anthropic = new Anthropic();

const system_prompt = `You are a AI engineer working on a prompt workflow. 
You have been tasked with creating a JSON Canvas diagram that shows the flow of prompts from a handwritten sketch.

The diagram should be formatted like this:

\`\`\`json
{
	"nodes":[
		{"type":"group","id":"161279baf7763214","x":-174,"y":-160,"width":394,"height":340,"label":"Cannoli"},
		{"type":"text","text":"Hello world!","id":"dc3f9351f787531e","x":-97,"y":-91,"width":250,"height":60},
		{"type":"text","text":"","id":"bc1a550bbb4aac7b","x":-97,"y":60,"width":250,"height":60,"color":"6"},
		{"type":"text","text":"The purple node is a content node. Content nodes can be used to store and display text that can be read or written by you or another node.","id":"f77169b141243e65","x":240,"y":30,"width":420,"height":120},
		{"type":"text","text":"The colorless, green, or yellow node is a call node. Call nodes make a chat completion call to the LLM with the text of the node as a user message.","id":"0af5a453bd4d6ec9","x":240,"y":-110,"width":380,"height":120},
		{"type":"text","text":"If a node in a cannoli is floating (no arrows attached) it won't affect the cannoli unless it is formatted in a special way we'll go over later.","id":"7d005c80299f3674","x":-202,"y":220,"width":461,"height":112},
		{"type":"text","text":"This is a Cannoli. It's made up of different types of nodes and arrows.\n\nTry running it by clicking the Cannoli button in the control ribbon on the left side of your Obsidian window.","id":"24dd96c964700992","x":-147,"y":-400,"width":350,"height":180},
		{"type":"text","text":"Cannolis can be run in several ways:\n\n- Click the Cannoli ribbon icon\n    - If you're on a canvas file, it will be run as a cannoli\n    - If you're on a note with a \"cannoli\" property, the canvas file in that property will be run as a cannoli\n- Run the \"Start/Stop cannoli\" command in the command palette (functions the same as the ribbon icon)\n- If a canvas file name ends with \".cno\", it will have its own run command in the command palette\n- Make an audio recording on a note with a \"cannoli\" property\n\t- That recording will be transcribed, replace the reference, and trigger the cannoli defined in the property.","id":"927cf33512b0dfc1","x":-740,"y":-182,"width":538,"height":402}
	],
	"edges":[
		{"id":"23c2d7dffb49bf75","fromNode":"dc3f9351f787531e","fromSide":"bottom","toNode":"bc1a550bbb4aac7b","toSide":"top"}
	]
}
\`\`\``


const convertSketchToJSON = async function* (imageData: string, filename: string) {
  
  yield { message: 'Processing image...', status: 'running' };

  const user_prompt = 'Create a JSON Canvas. Only output the JSON code.'
  const msg = await anthropic.messages.create({
    model: MODEL_NAME,
    max_tokens: 2048,
    system: system_prompt,
    messages: [{ role: "user", content: [
      { type: "image", source: { type: "base64", media_type: "image/png", data: imageData } },
      { type: "text", text: user_prompt }]}],
  });
  console.log('LLM Response:', msg);

  let json_data = '';
  if (msg.content.length == 1 && msg.content[0].type == 'text') {
    json_data = msg.content[0].text;
  }
  if (json_data.indexOf('```json\n') >= 0) {
    json_data = json_data.slice(json_data.indexOf('```json\n') + 8);
    json_data = json_data.replace('```', '');
    json_data = json_data.trim();
  }

  yield { message: 'Saving canvas...', status: 'running' };

  try {
    await new Promise<void>((resolve, reject) => {
      fs.writeFile(filename, json_data, (err) => {
        if (err) {
          console.error(err);
          reject(err);
        } else {
          resolve();
        }
      });
    });
    yield { message: 'Canvas saved successfully', status: 'success' };
  } catch (err) {
    yield { message: 'Error saving canvas', status: 'error' };
  }
}
 
export async function POST(request: NextRequest) {
  const data = await request.json();

  let image_data = data.imageData;
  if (image_data.startsWith('data:image/png;base64,')) {
    image_data = image_data.replace('data:image/png;base64,', '');
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const vaultPath = process.env.OBSIDIAN_VAULT;
        if (vaultPath == undefined) {
          throw new Error('OBSIDIAN_VAULT environment variable not set');
        } else {
          const outputFilename = path.join(vaultPath, `${data.name}.canvas`);
          for await (const chunk of convertSketchToJSON(image_data, outputFilename)) {
            controller.enqueue(encoder.encode(JSON.stringify(chunk) + '\n'));
          }
        }
      } catch (error: any) {
        controller.enqueue(encoder.encode(JSON.stringify({'message': `Error: ${error.message}`, 'status': 'error'}) + '\n'));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain',
      'Transfer-Encoding': 'chunked',
    },
  });
}