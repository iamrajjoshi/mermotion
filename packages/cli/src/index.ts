#!/usr/bin/env node

import {
  compileMotion,
  formatMotion,
  parseMotion,
  sampleTimeline,
  validateMermaid,
  validateMotion,
} from '@mermotion/engine';
import { runCli, type CliDependencies } from './cli.js';
import { prepareRenderer, renderDiagram } from './render.js';

const dependencies: CliDependencies = {
  engine: {
    compileMotion,
    formatMotion,
    parseMotion,
    sampleTimeline,
    validateMermaid,
    validateMotion,
  },
  prepareRenderer,
  render: renderDiagram,
  output: {
    stdout: (message) => process.stdout.write(message),
    stderr: (message) => process.stderr.write(message),
  },
};

export async function main(arguments_: readonly string[] = process.argv.slice(2)): Promise<number> {
  return runCli(arguments_, dependencies);
}

process.exitCode = await main();
