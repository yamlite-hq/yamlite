import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { instructionsApi } from "@/lib/ai";
import { ApiError } from "@/lib/api";
import { GIT_KEY } from "@/lib/git";
import { m } from "@/paraglide/messages.js";

const KEY = ["ai-instructions"];

export function AiInstructionsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const client = useQueryClient();
  // read once per opening: a refetch would replace what is being typed, and base must stay the one edited from
  const loaded = useQuery({
    queryKey: KEY,
    queryFn: instructionsApi.get,
    enabled: open,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const [all, setAll] = useState("");
  const [pr, setPr] = useState("");
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    if (!loaded.data || seeded) return;
    setAll(loaded.data.instructions ?? "");
    setPr(loaded.data.pullRequests ?? "");
    setSeeded(true);
  }, [loaded.data, seeded]);
  const save = useMutation({
    mutationFn: () => instructionsApi.save({ instructions: all, pullRequests: pr, base: loaded.data?.base ?? "" }),
    onSuccess: (saved) => {
      client.setQueryData(KEY, saved);
      // yamlite.yaml is now a change to send
      void client.invalidateQueries({ queryKey: GIT_KEY });
      toast.success(m.ai_instructions_saved());
      onOpenChange(false);
    },
  });
  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) {
      save.reset();
      void client.removeQueries({ queryKey: KEY });
    }
  };
  const error =
    save.error instanceof ApiError && save.error.status === 409
      ? m.ai_instructions_conflict()
      : save.error instanceof Error
        ? save.error.message
        : loaded.error instanceof Error
          ? loaded.error.message
          : null;
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-[18px]">{m.ai_instructions_title()}</DialogTitle>
          <DialogDescription className="text-[14px]">{m.ai_instructions_note()}</DialogDescription>
        </DialogHeader>
        <label className="flex flex-col gap-1.5 text-[15px]">
          <span className="font-semibold">{m.ai_instructions_all()}</span>
          <Textarea
            value={all}
            placeholder={m.ai_instructions_all_example()}
            onChange={(e) => setAll(e.target.value)}
            disabled={!loaded.data}
            className="min-h-28 text-[15px]"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-[15px]">
          <span className="font-semibold">{m.ai_instructions_pr()}</span>
          <Textarea
            value={pr}
            placeholder={m.ai_instructions_pr_example()}
            onChange={(e) => setPr(e.target.value)}
            disabled={!loaded.data}
            className="min-h-20 text-[15px]"
          />
        </label>
        {error && (
          <p role="alert" className="text-[13px] text-err">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>
            {m.common_cancel()}
          </Button>
          <Button disabled={!loaded.data || save.isPending} onClick={() => save.mutate()}>
            {m.common_save()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
