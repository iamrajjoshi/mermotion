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

const dependencies: CliDependencies = {
  engine: {
    compileMotion,
    formatMotion,
    parseMotion,
    sampleTimeline,
    validateMermaid,
    validateMotion,
  },
  output: {
    stdout: (message) => process.stdout.write(message),
    stderr: (message) => process.stderr.write(message),
  },
};

process.exitCode = await runCli(process.argv.slice(2), dependencies);
