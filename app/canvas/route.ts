import path from 'path';
import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { parseCanvasFromResponse, parseGraphFromJSON, saveCanvas } from '@/lib';
import { Graph } from '@/types';
import { StatusUpdate } from '@/types/status';

const MODEL_NAME = "claude-3-opus-20240229";

const anthropic = new Anthropic();

const default_system_prompt = `You are a AI engineer working on a prompt workflow. 
You have been tasked with creating a JSON Canvas diagram that shows the flow of prompts from a handwritten sketch.
Make sure that you transcribe the text as accurately as possible.
Only transcribe the text from the system prompts and user prompts.
If there are no arrows in the sketch, you should add them to the JSON Canvas diagram assuming the direction of the arrows.

Here is an example of what the completed JSON might look like:

<canvas>
{
	"nodes":[
		{"id":"node1","type":"text","text":"","x":203,"y":81,"width":25,"height":43,"color":"4"},
		{"id":"node2","type":"text","text":"","x":122,"y":101,"width":33,"height":27},
		{"id":"node3","type":"text","text":"","x":155,"y":151,"width":52,"height":59,"color":"6"}
	],
	"edges":[
		{"id":"edge1","fromNode":"node1","fromSide":"top","toNode":"node2","toSide":"top"},
		{"id":"edge2","fromNode":"node3","fromSide":"top","toNode":"node1","toSide":"left"},
		{"id":"edge3","fromNode":"node2","fromSide":"bottom","toNode":"node3","toSide":"left"}
	]
}
</canvas>
`


const cannoli_system_prompt = `You are a expert technical diagram converter. 
Your task is to create a JSON Canvas diagram from a handwritten sketch.
Make sure that you transcribe the text as accurately as possible. 
All nodes must have a "type" of "text" and a "text" value of "".
All system prompts should bvy purple nodes and connect to a user prompt.
All user prompts should be gray nodes and connect to an assistant response.
All assistant nodes should be purple nodes.
If no assistant nodes is present, you should add one connected to the last user node.
Pay extra attention to the direction of the arrows in the sketch. The start of the arrow represents the "fromNode" and the wider end of the arrow represents the "toNode".

EVERY node has a color must be specified in the node's JSON object as follows:

<colors>
Black or gray: {"type":"text", ... }
Red: {"type":"text", ... , "color":"1"}
Orange: {"type":"text", ... , "color":"2"}
Yellow: {"type":"text", ... , "color":"3"}
Green: {"type":"text", ... , "color":"4"}
Blue: {"type":"text", ... , "color":"5"}
Purple: {"type":"text", ... , "color":"6"}
</colors>

Here is an example of what the completed JSON might look like:

<canvas>
{
	"nodes":[
		{"id":"node1","type":"text","text":"","x":203,"y":81,"width":25,"height":43,"color":"4"},
		{"id":"node2","type":"text","text":"","x":122,"y":101,"width":33,"height":27},
		{"id":"node3","type":"text","text":"","x":155,"y":151,"width":52,"height":59,"color":"6"}
	],
	"edges":[
		{"id":"edge1","fromNode":"node1","fromSide":"top","toNode":"node2","toSide":"top"},
		{"id":"edge2","fromNode":"node3","fromSide":"top","toNode":"node1","toSide":"left"},
		{"id":"edge3","fromNode":"node2","fromSide":"bottom","toNode":"node3","toSide":"left"}
	]
}
</canvas>
`


const variables_system_prompt = `You are a expert technical diagram builder.
You have been tasked with creating a JSON Canvas diagram that shows the flow of prompts from a handwritten sketch.

To add parameters to the JSON Canvas diagram, you need to add a new node and an edge connecting it to the existing node where the parameter is used.
All parameter nodes have color "6" and are represented as empty text nodes.
Make sure that the new parameter node does not overlap with any existing nodes.

For example, the following parameters produced the following JSON Canvas diagram:

<canvas>
{
  "nodes": [
    ...,
    {
      "type": "text",
      "text": "What is the capital of {{country}}",
      "id": "node1",
      "x": -135,
      "y": -160,
      "width": 270,
      "height": 60
    }
  ],
  "edges": [
    ...
  ]
}
</canvas>

Add the following parameters to the JSON Canvas diagram:

<parameters>
Variable "country" connects to node "c05f05c824cc0a17"
</parameters>

<canvas>
{
  "nodes": [
    ...,
    {
      "type": "text",
      "text": "What is the capital of {{country}}?",
      "id": "node1",
      "x": -135,
      "y": -160,
      "width": 270,
      "height": 60
    },
    {
      "type": "text",
      "text": "",
      "id": "node2",
      "x": -67,
      "y": 80,
      "width": 135,
      "height": 60,
      "color": "6"
    }
  ],
  "edges": [
    ...,
    {
      "id": "edge1",
      "label": "country"
      "fromNode": "node2",
      "fromSide": "bottom",
      "toNode": "node1",
      "toSide": "top"
    }
  ]
}
</canvas>
`

const convertSketchToJSON = async function* (imageData: string, filename: string, system_prompt: string, variablePattern: RegExp): AsyncGenerator<StatusUpdate> {
  
  yield { message: 'Processing image...', status: 'running' };

  const user_prompt = 'Create a JSON Canvas. Only output the JSON code.'
  const response = await anthropic.messages.create({
    model: MODEL_NAME,
    max_tokens: 2048,
    system: system_prompt,
    messages: [{ role: "user", content: [
      { type: "image", source: { type: "base64", media_type: "image/png", data: imageData } },
      { type: "text", text: user_prompt }]}],
  });
  console.log('LLM Response:', response);

  let canvas: Graph = parseCanvasFromResponse(response);

  for await (const chunk of saveCanvas(canvas, filename)) {
    yield chunk;
  }

  let { variablesByNode, updatedGraph } = extractVariables(canvas, variablePattern);
  if (Object.keys(variablesByNode).length > 0) {
    yield { message: 'Adding variables to canvas...', status: 'running' };
    const var_user_prompt = `<canvas>
${JSON.stringify(updatedGraph, null, 2)}
</canvas>

Add the following parameters to the JSON Canvas diagram:

<parameters>
${formatVariables(variablesByNode)}
</parameters>`;

    const var_response = await anthropic.messages.create({
      model: MODEL_NAME,
      max_tokens: 2048,
      system: variables_system_prompt,
      messages: [{ role: "user", content: [
        { type: "text", text: var_user_prompt }]}],
    });
    console.log('Var prompt response:', var_response);

    canvas = parseCanvasFromResponse(var_response);

    yield { message: `Added ${Object.keys(variablesByNode).length} variables to canvas`, status: 'success' };

    for await (const chunk of saveCanvas(canvas, filename)) {
      yield chunk;
    }
  }
}

function extractVariables(graph: Graph, variablePattern: RegExp): { 
  variablesByNode: { [key: string]: Set<string> },
  updatedGraph: Graph 
} {
  const variablesByNode: { [key: string]: Set<string> } = {};
  const updatedGraph: Graph = JSON.parse(JSON.stringify(graph)); // Deep copy

  for (const node of updatedGraph.nodes) {
    if ('text' in node && node.text) {
      const variables = new Set<string>();
      node.text = node.text.replace(variablePattern, (match, p1) => {
        const varName = p1.toLowerCase();
        variables.add(varName);
        return `{{${varName}}}`;
      });

      if (variables.size > 0) {
        variablesByNode[node.id] = variablesByNode[node.id] 
          ? new Set([...variablesByNode[node.id], ...variables])
          : variables;
      }
    }
  }

  return { variablesByNode, updatedGraph };
}

function formatVariables(variablesByNode: { [key: string]: Set<string> }): string {
  let output = '';
  for (const [node, variables] of Object.entries(variablesByNode)) {
    for (const variable of variables) {
      output += `Variable "${variable.toLowerCase()}" connects to node "${node}"\n`;
    }
  }
  return output;
}

const buildVariablePattern = (pattern: string): RegExp => {
  pattern = pattern.replace(/([.*+?^=!:${}()|\[\]\/\\])/g, "\\$1");
  pattern = pattern.replace(/VAR/g, '(\\w+)');
  return new RegExp(pattern, 'g');
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
          let system_prompt = default_system_prompt;
          if (data.mode == 'cannoli') {
            system_prompt = cannoli_system_prompt;
          }
          let variablePattern = new RegExp(`\\$(\\w+)`, 'g')
          if (data.variablePattern) {
            variablePattern = buildVariablePattern(data.variablePattern);
          }
          for await (const chunk of convertSketchToJSON(image_data, outputFilename, system_prompt, variablePattern)) {
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