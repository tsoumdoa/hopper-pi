import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HopperStoreProvider } from "./state/hopper-store-context";
import { SharedApp } from "./shared/app";
import { App } from "./app";
import "./styles/globals.css";

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<HopperStoreProvider>
			{location.pathname === "/shared" ? <SharedApp /> : <App />}
		</HopperStoreProvider>
	</StrictMode>,
);
