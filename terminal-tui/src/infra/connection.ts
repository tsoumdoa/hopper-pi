export const PUB_ENDPOINT = process.env.GH_ZMQ_PUB || "tcp://localhost:5555";
export const PUSH_ENDPOINT = process.env.GH_ZMQ_PUSH || "tcp://localhost:5556";
export const REQ_ENDPOINT = process.env.GH_ZMQ_REQ || "tcp://localhost:5557";
export const COMMAND_ACK_TIMEOUT_MS = parseInt(process.env.GH_ACK_TIMEOUT_MS || "5000", 10);
export const DEBUG = process.env.GH_DEBUG === "1";