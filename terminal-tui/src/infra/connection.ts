export const PUB_ENDPOINT = process.env.GH_ZMQ_PUB || "tcp://localhost:5555";
export const REQ_ENDPOINT = process.env.GH_ZMQ_REQ || "tcp://localhost:5556";
export const REQUEST_TIMEOUT = parseInt(process.env.GH_TIMEOUT_MS || "30000", 10);
export const DEBUG = process.env.GH_DEBUG === "1";