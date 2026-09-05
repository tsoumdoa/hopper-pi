import { createContext, useContext, useState, type ReactNode } from "react";
import { useStore } from "zustand";
import { createHopperStore, type HopperStore, type HopperStoreState } from "./hopper-store";

const HopperStoreContext = createContext<HopperStore | null>(null);

export function HopperStoreProvider({ children, store }: { children: ReactNode; store?: HopperStore }) {
	const [ownedStore] = useState(() => store ?? createHopperStore());
	return <HopperStoreContext.Provider value={ownedStore}>{children}</HopperStoreContext.Provider>;
}

export function useHopperStoreApi() {
	const store = useContext(HopperStoreContext);
	if (!store) throw new Error("HopperStoreProvider is missing");
	return store;
}

export function useHopperStore<T>(selector: (state: HopperStoreState) => T): T {
	return useStore(useHopperStoreApi(), selector);
}
