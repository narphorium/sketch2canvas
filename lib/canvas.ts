import fs from 'fs';
import Anthropic from '@anthropic-ai/sdk';
import { Graph } from '../types/graph';
import { StatusUpdate } from '@/types/status';

export function parseGraphFromJSON(jsonString: string): Graph {
    try {
      const parsedData = JSON.parse(jsonString);
      
      if (typeof parsedData !== 'object' || parsedData === null) {
        throw new Error('Invalid JSON structure: expected an object');
      }
  
      if (!Array.isArray(parsedData.nodes) || !Array.isArray(parsedData.edges)) {
        throw new Error('Invalid graph structure: missing nodes or edges array');
      }
  
      // Validate nodes
      parsedData.nodes.forEach((node: any, index: number) => {
        if (typeof node.id !== 'string' || typeof node.type !== 'string' ||
            typeof node.x !== 'number' || typeof node.y !== 'number' ||
            typeof node.width !== 'number' || typeof node.height !== 'number') {
          throw new Error(`Invalid node at index ${index}: missing or invalid required properties`);
        }
      });
  
      // Validate edges
      parsedData.edges.forEach((edge: any, index: number) => {
        if (typeof edge.id !== 'string' || typeof edge.fromNode !== 'string' ||
            typeof edge.fromSide !== 'string' || typeof edge.toNode !== 'string' ||
            typeof edge.toSide !== 'string') {
          throw new Error(`Invalid edge at index ${index}: missing or invalid required properties`);
        }
      });
  
      return parsedData as Graph;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to parse graph from JSON: ${error.message}`);
      } else {
        throw new Error('Failed to parse graph from JSON: Unknown error');
      }
    }
  }

  export const parseCanvasFromResponse = (response: Anthropic.Messages.Message): Graph => {
    if (response.content.length == 1 && response.content[0].type == 'text') {
      let json_data = response.content[0].text;
      if (json_data.indexOf('<canvas>') >= 0) {
        json_data = json_data.slice(json_data.indexOf('<canvas>') + 8);
        json_data = json_data.replace('</canvas>', '');
        json_data = json_data.trim();
      }
      return parseGraphFromJSON(json_data);
    }
    return {} as Graph;
  }
  
  export const saveCanvas = async function* (canvas: Graph, filename: string): AsyncGenerator<StatusUpdate> {
    yield { message: 'Saving canvas...', status: 'running' };
    try {
      await new Promise<void>((resolve, reject) => {
        fs.writeFile(filename, JSON.stringify(canvas, null, 2), (err) => {
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