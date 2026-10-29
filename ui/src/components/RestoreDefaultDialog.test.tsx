import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, expect, test, vi } from "vitest";
import { type DefaultChange, gitApi } from "@/lib/git";
import { RestoreDefaultDialog } from "./RestoreDefaultDialog";

vi.mock("@/lib/git", async (orig) => {
  const real = await orig<typeof import("@/lib/git")>();
  return { ...real, gitApi: { ...real.gitApi, defaultChanges: vi.fn(), restoreDefault: vi.fn() } };
});
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
afterEach(() => vi.clearAllMocks());

const files: DefaultChange[] = [
  { path: "tasks/a.yaml", status: "modified", table: "tasks", unsent: false },
  { path: "tasks/b.yaml", status: "added", table: "tasks", unsent: true },
  { path: "notes.txt", status: "deleted", table: null, unsent: false },
];

function renderDialog(onOpenChange = () => {}) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <RestoreDefaultDialog branch="main" open onOpenChange={onOpenChange} />
    </QueryClientProvider>,
  );
}

const restoreButton = () => screen.getByRole("button", { name: /^Restore \d+ file/ }) as HTMLButtonElement;

test("lists the review's files by table, marking unsent edits, with none chosen", async () => {
  vi.mocked(gitApi.defaultChanges).mockResolvedValue(files);
  renderDialog();
  await waitFor(() => expect(screen.getByRole("checkbox", { name: "Include tasks/a.yaml" })).toBeTruthy());
  expect(screen.getByText("Restore from main")).toBeTruthy();
  expect(screen.getByText("Other files")).toBeTruthy();
  expect(screen.getAllByText("unsent edits")).toHaveLength(1);
  expect(restoreButton().disabled).toBe(true);
});

test("restores the chosen files, then closes", async () => {
  vi.mocked(gitApi.defaultChanges).mockResolvedValue(files);
  vi.mocked(gitApi.restoreDefault).mockResolvedValue({ files: ["tasks/a.yaml", "notes.txt"] });
  const onOpenChange = vi.fn();
  renderDialog(onOpenChange);
  fireEvent.click(await screen.findByRole("checkbox", { name: "Include tasks/a.yaml" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Include notes.txt" }));
  fireEvent.click(restoreButton());
  await waitFor(() => expect(gitApi.restoreDefault).toHaveBeenCalledWith(["tasks/a.yaml", "notes.txt"]));
  await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  expect(toast.success).toHaveBeenCalledWith("Restored 2 files from main; send them to add them to the review");
});

test("a file with unsent edits is asked for twice", async () => {
  vi.mocked(gitApi.defaultChanges).mockResolvedValue(files);
  vi.mocked(gitApi.restoreDefault).mockResolvedValue({ files: ["tasks/b.yaml"] });
  renderDialog();
  fireEvent.click(await screen.findByRole("checkbox", { name: "Include tasks/b.yaml" }));
  fireEvent.click(restoreButton());
  expect(gitApi.restoreDefault).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Restore 1 file, losing unsent edits" }));
  await waitFor(() => expect(gitApi.restoreDefault).toHaveBeenCalledWith(["tasks/b.yaml"]));
});

test("says so when the review changes nothing, and shows a failure", async () => {
  vi.mocked(gitApi.defaultChanges).mockResolvedValue([]);
  const { unmount } = renderDialog();
  expect(await screen.findByText("This review changes no files from main.")).toBeTruthy();
  unmount();
  vi.mocked(gitApi.defaultChanges).mockResolvedValue(files);
  vi.mocked(gitApi.restoreDefault).mockRejectedValue(new Error("tasks/a.yaml is the same as on the default branch"));
  renderDialog();
  fireEvent.click(await screen.findByRole("checkbox", { name: "Include tasks/a.yaml" }));
  fireEvent.click(restoreButton());
  expect((await screen.findByRole("alert")).textContent).toBe("tasks/a.yaml is the same as on the default branch");
});
