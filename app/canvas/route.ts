import path from 'path';
import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { parseCanvasFromResponse, saveCanvas } from '@/lib';
import { Canvas, NodeColor } from '@/types';
import { StatusUpdate } from '@/types/status';
import { metaprompt } from './metaprompt';

const MODEL_NAME = "claude-3-5-sonnet-20240620";

const anthropic = new Anthropic();

const default_system_prompt = `You are a AI engineer working on a prompt workflow. 
You have been tasked with creating a JSON Canvas diagram that shows the flow of prompts from an image of a prompt.
Make sure that you transcribe the text as accurately as possible.
Only transcribe the text from the  prompts. Ignore all other text on the page including the title and any other text that is not part of the prompt.
Do not include the text "SYSTEM PROMPT" or "USER PROMPT" in the JSON Canvas diagram.
If there are no arrows in the sketch, you should add them to the JSON Canvas diagram assuming the direction of the arrows.
ALWAYS wrap the JSON Canvas output in <canvas> tags.

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
Make sure that you transcribe ALL the text as accurately as possible.
All nodes must have a "type" of "text" and a "text" value of "".
All system prompts should be purple nodes and connect to a user prompt.
All user prompts should be gray nodes and connect to an assistant response.
All assistant nodes should be purple nodes.
Green text represents metaprompts.
Metaprompts connect to a system prompt or a user prompt but not both. 
A green arrow should connect the metaprompt to the node that is modifying.
If no assistant nodes is present, you should add one connected to the last user node.
Only transcribe the text from the prompts and metaprompts. Ignore all other text on the page including the title and any other text that is not part of the prompt or metaprompt.
Pay extra attention to the direction of the arrows in the sketch. The start of the arrow represents the "fromNode" and the wider end of the arrow represents the "toNode".
Make sure the JSON Canvas output is always wrapped in <canvas> tags.

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
Make sure the JSON canvas is always wrapped in <canvas> tags and the parameters are wrapped in <parameters> tags.

For example, given the following JSON Canvas diagram and a list of paremeters:

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

Return an updated JSON Canvas diagram like this:

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

const extractMetaprompts = (canvas: Canvas): { metapromptsByNode: { [key: string]: string }, updatedCanvas: Canvas } => {
  let metapromptsByNode: { [key: string]: string } = {};
  let updatedCanvas: Canvas = { nodes: [], edges: []} as Canvas;

  // Extract metaprompts from the canvas
  canvas.edges.forEach((edge) => {
    const startNode = canvas.nodes.find((node) => node.id == edge.fromNode);
    if (startNode && startNode.color == NodeColor.GREEN) {
      if (startNode.text) {
        metapromptsByNode[edge.toNode] = startNode.text;
      }
    } else {
      updatedCanvas.edges.push(edge);
    }
  });

  // Remove all metaprompt nodes from the canvas
  canvas.nodes.forEach((node) => {
    if (node.color != NodeColor.GREEN) {
      updatedCanvas.nodes.push(node);
    }
  });
  return {metapromptsByNode, updatedCanvas};
}

const postProcessCannoliCanvas = (canvas: Canvas): Canvas => {
  // This is a set of heuristics to make sure that the output JSON Canvas
  // conforms to the expected format for the Cannoli plugin.

  // Create lists of all root nodes and all leaf nodes
  const rootNodes = new Set<string>(canvas.nodes.map((node) => node.id));
  const leafNodes = new Set<string>(canvas.nodes.map((node) => node.id));
  canvas.edges.forEach((edge) => {
    rootNodes.delete(edge.toNode);
    leafNodes.delete(edge.fromNode);
  });

  
  canvas.nodes.forEach((node) => {
    if (node.type == 'text') {
      if (node.text?.toLowerCase().trim() == 'assistant') {
        // Look for nodes with "assistant" text and color them purple
        node.text = '';
        node.color = NodeColor.PURPLE;
      } else if (((node.id in leafNodes) || (node.id in rootNodes)) && node.color != NodeColor.GREEN) {
        // Make sure that all leaf nodes and root nodes are purple unless they are metaprompts
        node.color = NodeColor.PURPLE;
      }
    }
  });
  
  return canvas;
}

const convertSketchToJSON = async function* (imageData: string, filename: string, system_prompt: string, variablePattern: RegExp, metapromptsEnabled: boolean): AsyncGenerator<StatusUpdate> {
  
  yield { message: 'Processing image...', status: 'running' };

  // Send the image to the LLM model to generate a JSON Canvas
  const user_prompt = 'Create a JSON Canvas from this sketch.'
  const response = await anthropic.messages.create({
    model: MODEL_NAME,
    max_tokens: 2048,
    system: system_prompt,
    temperature: 0.0,
    messages: [{ role: "user", content: [
      { type: "image", source: { type: "base64", media_type: "image/png", data: imageData } },
      { type: "text", text: user_prompt }]}],
  });
  console.log('LLM Response:', response);

  // Parse the JSON Canvas from the response and save it to a file
  let canvas: Canvas = parseCanvasFromResponse(response);
  for await (const chunk of saveCanvas(canvas, filename)) {
    yield chunk;
  }

  // Extract metaprompts from the canvas and generate prompts for them
  if (metapromptsEnabled) {
    let { metapromptsByNode, updatedCanvas } = extractMetaprompts(canvas);
    if (Object.keys(metapromptsByNode).length > 0) {
      for (const [node, task] of Object.entries(metapromptsByNode)) {
        yield { message: `Generating prompt for ${node}`, status: 'running' };
        const user_prompt = metaprompt.replace('{{TASK}}', task);
        const assistant_partial = `<Instructions Structure>`
        const metaprompt_response = await anthropic.messages.create({
          model: MODEL_NAME,
          max_tokens: 2048,
          temperature: 0.0,
          messages: [{ role: "user", content: [
            { type: "text", text: user_prompt },
          ]}],
        });
        console.log('Metaprompt response:', metaprompt_response);

        const target_node = updatedCanvas.nodes.find((n) => n.id == node);
        if (target_node && metaprompt_response.content[0]['type'] == 'text') {
          target_node.text = metaprompt_response.content[0].text;
          if (target_node.text.indexOf('<Instructions>') >= 0) {
            target_node.text = target_node.text.slice(target_node.text.indexOf('<Instructions>') + 14);
            target_node.text = target_node.text.replace('</Instructions>', '');
            target_node.text = target_node.text.trim();
          }
        }
        
        // Add the metaprompt back to the canvas and save it
        for await (const chunk of saveCanvas(updatedCanvas, filename)) {
          yield chunk;
        }
      }
    }
    canvas = updatedCanvas;
  }

  // If there are variables in the canvas, prompt the LLM to add them to the JSON Canvas
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
      temperature: 0.0,
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

  // Post-process the canvas to make sure it conforms to the Cannoli format
  if (system_prompt === cannoli_system_prompt) {
    yield { message: 'Post-processing canvas...', status: 'running' };
    canvas = postProcessCannoliCanvas(canvas);
    for await (const chunk of saveCanvas(canvas, filename)) {
      yield chunk;
    }
  }
}

function extractVariables(graph: Canvas, variablePattern: RegExp): { 
  variablesByNode: { [key: string]: Set<string> },
  updatedGraph: Canvas 
} {
  const variablesByNode: { [key: string]: Set<string> } = {};
  const updatedGraph: Canvas = JSON.parse(JSON.stringify(graph)); // Deep copy

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
          console.log('Mode:', data.mode);
          if (data.mode == 'cannoli') {
            system_prompt = cannoli_system_prompt;
          }
          let variablePattern = new RegExp(`\\$(\\w+)`, 'g')
          if (data.variablePattern) {
            variablePattern = buildVariablePattern(data.variablePattern);
          }
          let metapromptsEnabled = false;
          console.log('Metaprompting:', data.metaprompting);
          if (data.metaprompting === true) {
            metapromptsEnabled = true;
          }
          for await (const chunk of convertSketchToJSON(image_data, outputFilename, system_prompt, variablePattern, metapromptsEnabled)) {
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