import {
	beginTransactionPairStrict,
	cancelTransactionPairStrict,
	commitTransactionPairStrict,
} from "../services/transaction-lifecycle.js";
import type { HopperCallContext, HopperResult, HopperToolSpec } from "./tool-contract.js";
import { errorResult, resultFromThrown } from "./tool-error.js";

export type TransactionPair = {
	begin(): Promise<void>;
	commit(): Promise<void>;
	cancel(): Promise<void>;
};

const defaultTransactions: TransactionPair = {
	begin: beginTransactionPairStrict,
	commit: commitTransactionPairStrict,
	cancel: cancelTransactionPairStrict,
};

let mutationTail = Promise.resolve();

async function serialized<T>(run: () => Promise<T>): Promise<T> {
	const previous = mutationTail;
	let release!: () => void;
	mutationTail = new Promise<void>((resolve) => {
		release = resolve;
	});
	await previous;
	try {
		return await run();
	} finally {
		release();
	}
}

async function cancelQuietly(transactions: TransactionPair): Promise<void> {
	try {
		await transactions.cancel();
	} catch {
		// Preserve the tool failure that caused the cancellation.
	}
}

async function executeReadOnly(
	spec: HopperToolSpec,
	input: unknown,
	ctx: HopperCallContext,
): Promise<HopperResult> {
	try {
		ctx.signal?.throwIfAborted();
		return await spec.execute(input, ctx);
	} catch (error) {
		return resultFromThrown(error);
	}
}

/**
 * MCP has no agent-turn lifecycle, so destructive calls get one serialized
 * transaction pair each. The current bridge sends transaction markers over
 * PUSH while some tools use REQ/REP. This wrapper is best-effort until the C#
 * bridge can execute the whole call through one ordered backend operation.
 */
export async function executeHopperTool(
	spec: HopperToolSpec,
	input: unknown,
	ctx: HopperCallContext,
	transactions: TransactionPair = defaultTransactions,
): Promise<HopperResult> {
	if (!spec.annotations.destructiveHint) {
		return executeReadOnly(spec, input, ctx);
	}

	return serialized(async () => {
		let began = false;
		try {
			ctx.signal?.throwIfAborted();
			began = true;
			await transactions.begin();
			const result = await spec.execute(input, ctx);

			if (ctx.signal?.aborted) {
				await cancelQuietly(transactions);
				return errorResult("cancelled", "Hopper tool call cancelled.", { retryable: true });
			}
			if (result.isError) {
				await cancelQuietly(transactions);
				return result;
			}

			await transactions.commit();
			return result;
		} catch (error) {
			if (began) await cancelQuietly(transactions);
			return resultFromThrown(error);
		}
	});
}
