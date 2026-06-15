export function throwNoUi(toolName: "ask_user" | "pick_option"): never {
	throw new Error(
		`${toolName} requires an interactive UI, which is not available in this session. Proceed without asking the user; use reasonable defaults or state assumptions in your reply.`,
	);
}
