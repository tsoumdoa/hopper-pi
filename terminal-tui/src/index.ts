#!/usr/bin/env node

import { Command } from "commander";
import { setupCommands } from "./cli/commands.js";

const program = new Command();

program
	.name("gh")
	.description("CLI tool for interacting with Grasshopper via ZMQ")
	.version("1.0.0");

setupCommands(program);

program.parse(process.argv);