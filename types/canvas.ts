export enum NodeColor {
    RED = '1',
    ORANGE = '2',
    YELLOW = '3',
    GREEN = '4',
    BLUE = '5',
    PURPLE = '6'
}

export interface Node {
    type: string;
    text?: string;
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    color?: NodeColor;
}

export interface Edge {
    id: string;
    fromNode: string;
    fromSide: string;
    toNode: string;
    toSide: string;
}

export interface Canvas {
    nodes: Node[];
    edges: Edge[];
}