import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { instructionsApi } from "@/lib/ai";
import { ApiError } from "@/lib/api";
import { AiInstructionsDialog } from "./AiInstructionsDialog";

vi.mock("@/lib/ai", async (orig) => {
  const real = await orig<typeof import("@/lib/ai")>();
  return { ...real, instructionsApi: { get: vi.fn(), save: vi.fn() } };
});
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
afterEach(() => vi.clearAllMocks());

function renderDialog(onOpenChange = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AiInstructionsDialog open onOpenChange={onOpenChange} />
    </QueryClientProvider>,
  );
  return onOpenChange;
}

const ALL = "All AI features (Ask AI and pull request drafts)";
const PR = "Pull request drafts, in addition to the above";

test("shows the saved instructions and saves the edits with the base it read", async () => {
  vi.mocked(instructionsApi.get).mockResolvedValue({ instructions: "Be brief.", pullRequests: null, base: "h1" });
  vi.mocked(instructionsApi.save).mockResolvedValue({
    instructions: "Be brief.",
    pullRequests: "Say why.",
    base: "h2",
  });
  const onOpenChange = renderDialog();
  await waitFor(() =>
    expect((screen.getByRole("textbox", { name: ALL }) as HTMLTextAreaElement).value).toBe("Be brief."),
  );
  fireEvent.change(screen.getByRole("textbox", { name: PR }), { target: { value: "Say why." } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  expect(instructionsApi.save).toHaveBeenCalledWith({
    instructions: "Be brief.",
    pullRequests: "Say why.",
    base: "h1",
  });
});

test("a file changed meanwhile is reported and the dialog stays open", async () => {
  vi.mocked(instructionsApi.get).mockResolvedValue({ instructions: null, pullRequests: null, base: "h1" });
  vi.mocked(instructionsApi.save).mockRejectedValue(new ApiError(409, "yamlite.yaml changed", {}));
  const onOpenChange = renderDialog();
  await waitFor(() => expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect((await screen.findByRole("alert")).textContent).toContain("yamlite.yaml changed while you were editing");
  expect(onOpenChange).not.toHaveBeenCalled();
});
