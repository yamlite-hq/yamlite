import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { History } from "lucide-react";
import { useState } from "react";
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
import { type ChangeKind, GIT_KEY, gitApi, groupChanges } from "@/lib/git";
import { cn } from "@/lib/utils";
import { m } from "@/paraglide/messages.js";

const KIND: Record<ChangeKind, () => string> = {
  added: m.review_status_added,
  modified: m.review_status_modified,
  deleted: m.review_status_deleted,
};

const KIND_CLASS: Record<ChangeKind, string> = {
  added: "text-ok",
  modified: "text-warn",
  deleted: "text-err",
};

// puts files the review changes back as the default branch has them; they then go out like any other edit
export function RestoreDefaultDialog({
  branch,
  open,
  onOpenChange,
}: {
  branch: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const client = useQueryClient();
  const { data: files, error: loadError } = useQuery({
    queryKey: [...GIT_KEY, "default"],
    queryFn: gitApi.defaultChanges,
    enabled: open,
  });
  const [checked, setChecked] = useState<Set<string>>(new Set());
  // the set the button was armed for; a different set asks again
  const [armedFor, setArmedFor] = useState<string | null>(null);
  const chosen = (files ?? []).filter((f) => checked.has(f.path));
  const losesEdits = chosen.some((f) => f.unsent);
  const chosenKey = JSON.stringify(chosen.map((f) => f.path));
  const confirm = armedFor === chosenKey;
  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) {
      restore.reset();
      setChecked(new Set());
      setArmedFor(null);
    }
  };
  const restore = useMutation({
    mutationFn: () => gitApi.restoreDefault(chosen.map((f) => f.path)),
    onSuccess: (r) => {
      toast.success(m.restore_done({ count: r.files.length, branch }));
      close(false);
    },
    onSettled: () => {
      setArmedFor(null);
      void client.invalidateQueries({ queryKey: GIT_KEY });
    },
  });
  const toggle = (path: string) =>
    setChecked((s) => {
      const next = new Set(s);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  const failure = restore.error ?? loadError;
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-[18px]">{m.restore_title({ branch })}</DialogTitle>
          <DialogDescription className="text-[14px]">{m.restore_description({ branch })}</DialogDescription>
        </DialogHeader>
        {!files ? (
          !loadError && <p className="text-[14px] text-muted-foreground">{m.review_loading()}</p>
        ) : files.length === 0 ? (
          <p className="text-[14px] text-muted-foreground">{m.restore_none({ branch })}</p>
        ) : (
          <fieldset className="flex max-h-[45vh] flex-col gap-2 overflow-auto rounded-md border p-3 text-[14px]">
            <legend className="px-1 text-[13px] text-muted-foreground">
              {m.review_files({ count: chosen.length })}
            </legend>
            {groupChanges(files).map((g) => (
              <div key={g.table ?? ""} className="flex flex-col gap-0.5">
                <div className="text-[12.5px] font-semibold text-muted-foreground">
                  {g.table ?? m.review_other_files()}
                </div>
                {g.changes.map((f) => (
                  <label key={f.path} className="flex min-w-0 items-center gap-2 rounded-md px-1 py-1">
                    <input
                      type="checkbox"
                      aria-label={m.review_include({ file: f.path })}
                      checked={checked.has(f.path)}
                      disabled={restore.isPending}
                      onChange={() => toggle(f.path)}
                    />
                    <span className="min-w-0 truncate font-mono text-[13.5px]">{f.path}</span>
                    {f.unsent && <span className="shrink-0 text-[12.5px] text-warn">{m.restore_unsent()}</span>}
                    <span className={cn("ml-auto shrink-0 text-[12.5px]", KIND_CLASS[f.status])}>
                      {KIND[f.status]()}
                    </span>
                  </label>
                ))}
              </div>
            ))}
          </fieldset>
        )}
        {failure && (
          <p role="alert" className="text-[13px] text-err">
            {failure.message}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>
            {m.common_cancel()}
          </Button>
          <Button
            variant={confirm ? "destructive" : "default"}
            disabled={chosen.length === 0 || restore.isPending}
            // edits not sent yet are lost, so they are asked for twice
            onClick={() => (losesEdits && !confirm ? setArmedFor(chosenKey) : restore.mutate())}
          >
            <History className="size-4" />
            {restore.isPending
              ? m.restore_restoring()
              : confirm
                ? m.restore_submit_confirm({ count: chosen.length })
                : m.restore_submit({ count: chosen.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
