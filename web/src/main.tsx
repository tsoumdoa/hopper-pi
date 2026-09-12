import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HopperStoreProvider } from "./state/hopper-store-context";
import { App } from "./app";
import "./styles/globals.css";

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<HopperStoreProvider>
			<App />
		</HopperStoreProvider>
	</StrictMode>,
);
