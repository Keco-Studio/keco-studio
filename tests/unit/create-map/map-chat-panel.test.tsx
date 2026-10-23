/** @jest-environment jsdom */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { MapChatPanel } from "@/features/create-map/components/MapChatPanel";

jest.mock("@/features/create-map/CreateMapWorkbench.module.css", () => ({
  __esModule: true,
  default: new Proxy({}, { get: (_target, property) => String(property) }),
}));
jest.mock("next/image", () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) =>
    React.createElement("img", props),
}));

const messages = [
  { id: "1", role: "user" as const, text: "Make a village map" },
  { id: "2", role: "assistant" as const, text: "Here is the created map plan" },
  { id: "3", role: "assistant" as const, text: "Here is the created map" },
];

function renderPanel(
  overrides: Partial<React.ComponentProps<typeof MapChatPanel>> = {},
) {
  const props: React.ComponentProps<typeof MapChatPanel> = {
    mapTitle: "Village map",
    messages,
    onBack: jest.fn(),
    onCreate: jest.fn(),
    onAsk: jest.fn(),
    canAsk: true,
    mapPlan: { title: "Village map plan", versionLabel: "Version1" },
    mapImage: {
      title: "Village map",
      versionLabel: "Version1",
      downloadUrl: "/map.png",
    },
    generationHistory: [
      { revisionId: "revision-1", label: "V1", isCurrent: true },
    ],
    onViewMapPlan: jest.fn(),
    ...overrides,
  };
  render(<MapChatPanel {...props} />);
  return props;
}

describe("MapChatPanel", () => {
  it("renders searchable messages, plan and image cards, and generation history", () => {
    renderPanel();
    expect(
      screen.getByRole("region", { name: "Map conversation" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "View map plan" })).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Download map" }).getAttribute("href"),
    ).toBe("/map.png");
    fireEvent.click(
      screen.getByRole("button", { name: "Show map generation history" }),
    );
    expect(screen.getByText("V1")).toBeTruthy();
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search messages" }),
      { target: { value: "village" } },
    );
    expect(screen.getByText("Make a village map")).toBeTruthy();
    expect(screen.queryByText("Here is the created map plan")).toBeNull();
  });

  it("submits a prompt and opens the attachment actions", () => {
    const onAsk = jest.fn();
    const onAttachKecoDocument = jest.fn();
    renderPanel({ onAsk, onAttachFile: jest.fn(), onAttachKecoDocument });
    fireEvent.change(screen.getByRole("textbox", { name: "Ask AI to help" }), {
      target: { value: "A river crossing" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onAsk).toHaveBeenCalledWith("A river crossing");
    fireEvent.click(screen.getByRole("button", { name: "Attach" }));
    expect(screen.getByRole("menuitem", { name: "File" })).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: "Keco Document" }));
    expect(onAttachKecoDocument).toHaveBeenCalledTimes(1);
  });

  it("sends immediately when the current Plan is preselected and still exposes Plan-only versions", () => {
    const onAsk = jest.fn();
    const onBasePlanChange = jest.fn();
    const currentPlanNodeId = "10000000-0000-4000-8000-000000000003";
    renderPanel({
      onAsk,
      followUpRequiresBasePlan: true,
      basePlanNodeId: currentPlanNodeId,
      onBasePlanChange,
      versionLibrary: {
        id: "10000000-0000-4000-8000-000000000001",
        projectId: "10000000-0000-4000-8000-000000000002",
        title: "Village",
        messages: [],
        nodes: [],
        planNodes: [
          {
            id: currentPlanNodeId,
            type: "plan",
            displayVersion: 1,
            displayLabel: "Plan V1",
            parentPlanNodeId: null,
            mapProjectId: "10000000-0000-4000-8000-000000000004",
            mapPlanVersionId: "10000000-0000-4000-8000-000000000005",
            createdAt: "2026-10-23T01:00:00.000Z",
            maps: [],
          },
        ],
      },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Ask AI to help" }), {
      target: { value: "Move the dock" },
    });
    expect(screen.getByRole("button", { name: "Send" }).hasAttribute("disabled")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onAsk).toHaveBeenCalledWith("Move the dock");
    fireEvent.change(screen.getByRole("combobox", { name: "Base Plan" }), {
      target: { value: currentPlanNodeId },
    });
    expect(onBasePlanChange).toHaveBeenCalledWith(currentPlanNodeId);
    fireEvent.click(
      screen.getByRole("button", { name: "Show map generation history" }),
    );
    expect(screen.getByRole("menuitem", { name: "Plan V1" })).toBeTruthy();
  });

  it("keeps the active Plan selectable before the version library finishes loading", () => {
    const activePlanNodeId = "10000000-0000-4000-8000-000000000007";
    renderPanel({
      messages: [],
      followUpRequiresBasePlan: true,
      basePlanNodeId: activePlanNodeId,
      activePlan: { id: activePlanNodeId, label: "Plan V2" },
      versionLibrary: null,
    });

    expect(
      (screen.getByRole("combobox", {
        name: "Base Plan",
      }) as HTMLSelectElement).value,
    ).toBe(activePlanNodeId);
    expect(screen.getByRole("option", { name: "Plan V2" })).toBeTruthy();
  });

  it("renders the persisted Plan artifact card from its conversation node", () => {
    const planNodeId = "10000000-0000-4000-8000-000000000003";
    const onSelectConversationNode = jest.fn();

    renderPanel({
      messages: [
        {
          id: "10000000-0000-4000-8000-000000000006",
          role: "assistant",
          text: "Map Plan created",
          artifactNodeId: planNodeId,
        },
      ],
      mapPlan: null,
      mapImage: null,
      onSelectConversationNode,
      versionLibrary: {
        id: "10000000-0000-4000-8000-000000000001",
        projectId: "10000000-0000-4000-8000-000000000002",
        title: "Island delivery",
        messages: [],
        nodes: [],
        planNodes: [
          {
            id: planNodeId,
            type: "plan",
            displayVersion: 2,
            displayLabel: "Plan V2",
            parentPlanNodeId: null,
            mapProjectId: "10000000-0000-4000-8000-000000000004",
            mapPlanVersionId: "10000000-0000-4000-8000-000000000005",
            createdAt: "2026-10-23T01:00:00.000Z",
            maps: [],
          },
        ],
      },
    });

    const planAction = screen.getByRole("button", { name: "View Plan V2" });
    expect(planAction.closest(".mapResourceCard")?.textContent).toContain(
      "Island deliveryPlan V2",
    );
    fireEvent.click(planAction);
    expect(onSelectConversationNode).toHaveBeenCalledWith(planNodeId);
  });

  it("renders a persisted Map artifact card from its exact conversation node", () => {
    const planNodeId = "10000000-0000-4000-8000-000000000003";
    const mapNodeId = "10000000-0000-4000-8000-000000000007";
    const onSelectConversationNode = jest.fn();

    renderPanel({
      messages: [
        {
          id: "10000000-0000-4000-8000-000000000006",
          role: "assistant",
          text: "Map generated",
          artifactNodeId: mapNodeId,
        },
      ],
      mapPlan: null,
      mapImage: {
        title: "Island delivery",
        versionLabel: "Version4",
        downloadUrl: "/island.png",
      },
      onSelectConversationNode,
      versionLibrary: {
        id: "10000000-0000-4000-8000-000000000001",
        projectId: "10000000-0000-4000-8000-000000000002",
        title: "Island delivery",
        messages: [],
        nodes: [],
        planNodes: [
          {
            id: planNodeId,
            type: "plan",
            displayVersion: 2,
            displayLabel: "Plan V2",
            parentPlanNodeId: null,
            mapProjectId: "10000000-0000-4000-8000-000000000004",
            mapPlanVersionId: "10000000-0000-4000-8000-000000000005",
            createdAt: "2026-10-23T01:00:00.000Z",
            maps: [
              {
                id: mapNodeId,
                type: "map",
                planNodeId,
                revisionId: "10000000-0000-4000-8000-000000000008",
                assetId: "10000000-0000-4000-8000-000000000009",
                mapVersionNumber: 1,
                status: "ready",
                createdAt: "2026-10-23T01:01:00.000Z",
                displayLabel: "Map V2.1",
              },
            ],
          },
        ],
      },
    });

    const mapAction = screen.getByRole("button", { name: "View Map V2.1" });
    expect(mapAction.closest(".mapResourceCard")?.textContent).toContain(
      "Island deliveryMap V2.1",
    );
    fireEvent.click(mapAction);
    expect(onSelectConversationNode).toHaveBeenCalledWith(mapNodeId);
  });

  it("renders one fallback Map card when a restored image has no Map message", () => {
    renderPanel({
      messages: [
        { id: "1", role: "user", text: "Restore the island map" },
        { id: "2", role: "assistant", text: "Map Plan created" },
      ],
    });

    expect(screen.getAllByRole("link", { name: "Download map" })).toHaveLength(1);
  });
});
