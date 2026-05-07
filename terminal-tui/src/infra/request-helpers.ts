import chalk from "chalk";
import { Requester } from "./requester.js";

export async function withRequester<T>(
	fn: (requester: Requester) => Promise<T>
): Promise<T> {
	const requester = new Requester();
	try {
		await requester.connect();
		return await fn(requester);
	} catch (err) {
		if (err instanceof Error && err.message.includes("ECONNREFUSED")) {
			console.error(chalk.red("Cannot connect to Grasshopper. Is Rhino open?"));
		} else {
			console.error(chalk.red("Request failed:"), err);
		}
		process.exit(1);
	} finally {
		await requester.close();
	}
}
