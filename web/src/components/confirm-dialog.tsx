import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";

export type ConfirmRequest = {
	title: string;
	description: string;
	confirmLabel: string;
	destructive?: boolean;
	action(): void;
};

export function ConfirmDialog({ request, onClose }: { request: ConfirmRequest | null; onClose(): void }) {
	return (
		<Dialog
			open={Boolean(request)}
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			{request && (
				<DialogContent className="w-[min(400px,calc(100%-2rem))]" hideClose>
					<DialogHeader>
						<DialogTitle>{request.title}</DialogTitle>
						<DialogDescription>{request.description}</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="secondary" onClick={onClose} autoFocus>Cancel</Button>
						<Button
							variant={request.destructive ? "destructive" : "default"}
							onClick={() => {
								request.action();
								onClose();
							}}
						>
							{request.confirmLabel}
						</Button>
					</DialogFooter>
				</DialogContent>
			)}
		</Dialog>
	);
}
