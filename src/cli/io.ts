export type CliIO = {
	stdin: NodeJS.ReadableStream;
	stdout: NodeJS.WritableStream;
	stderr: NodeJS.WritableStream;
	env: NodeJS.ProcessEnv;
	cwd: string;
};

export function processIO(): CliIO {
	return {
		stdin: process.stdin,
		stdout: process.stdout,
		stderr: process.stderr,
		env: process.env,
		cwd: process.cwd(),
	};
}

export function isTTY(io: CliIO): boolean {
	const stdout = io.stdout as NodeJS.WritableStream & { isTTY?: boolean };
	return stdout.isTTY === true;
}

export async function writeOut(io: CliIO, text: string): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		io.stdout.write(text, (error) => (error ? reject(error) : resolve()));
	});
}

export async function writeErr(io: CliIO, text: string): Promise<void> {
	await new Promise<void>((resolve) => {
		io.stderr.write(text, () => resolve());
	});
}
