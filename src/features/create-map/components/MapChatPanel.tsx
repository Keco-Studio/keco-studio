"use client";

import {
  ArrowLeftOutlined,
  ArrowUpOutlined,
  CloseOutlined,
  DownloadOutlined,
  FileTextOutlined,
  PlusOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import Image from "next/image";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import paperIcon from "@/assets/images/paper.svg";
import mapPlanIcon from "@/assets/images/simulator/map-plan.svg";
import {
  containsUnsafeDescriptionContent,
  DIRECT_MAP_UNSAFE_DESCRIPTION_MESSAGE,
} from "../model/directMapSchema";
import type { MapConversationSnapshot } from "../model/mapConversation";
import styles from "../CreateMapWorkbench.module.css";

export type MapChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  artifactNodeId?: string | null;
  basePlanNodeId?: string | null;
  pending?: boolean;
};

export type MapChatAttachedDocument = {
  id: string;
  name: string;
};

export type MapGenerationHistoryEntry = {
  revisionId: string;
  label: string;
  isCurrent: boolean;
};

export type MapPlanCard = {
  title: string;
  versionLabel: string;
};

export type MapImageCard = {
  title: string;
  versionLabel: string;
  downloadUrl: string;
};

export type ActiveMapPlan = {
  id: string;
  label: string;
};

type MapChatPanelProps = {
  mapTitle: string;
  messages: MapChatMessage[];
  onBack: () => void;
  onCreate?: () => void;
  onAsk: (prompt: string) => void;
  canAsk: boolean;
  busy?: boolean;
  readOnly?: boolean;
  error?: string | null;
  attachedDocument?: MapChatAttachedDocument | null;
  onClearAttachedDocument?: () => void;
  onAttachFile?: (file: File) => void;
  onAttachKecoDocument?: () => void;
  generationHistory?: MapGenerationHistoryEntry[];
  mapPlan?: MapPlanCard | null;
  mapImage?: MapImageCard | null;
  onViewMapPlan?: () => void;
  versionLibrary?: MapConversationSnapshot | null;
  onSelectConversationNode?: (nodeId: string) => void;
  followUpRequiresBasePlan?: boolean;
  basePlanNodeId?: string | null;
  onBasePlanChange?: (planNodeId: string | null) => void;
  activePlan?: ActiveMapPlan | null;
  fileAccept?: string;
};

function FileClipIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
      className={styles.chatAttachMenuIconSvg}
    >
      <path
        d="M10.5 4.5 5.75 9.25a2.121 2.121 0 1 0 3 3L13 8a3.536 3.536 0 0 0-5-5L4.25 6.75"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function MapChatPanel({
  mapTitle,
  messages,
  onBack,
  onCreate,
  onAsk,
  canAsk,
  busy = false,
  readOnly = false,
  error = null,
  attachedDocument = null,
  onClearAttachedDocument,
  onAttachFile,
  onAttachKecoDocument,
  generationHistory = [],
  mapPlan = null,
  mapImage = null,
  onViewMapPlan,
  versionLibrary = null,
  onSelectConversationNode,
  followUpRequiresBasePlan = false,
  basePlanNodeId = null,
  onBasePlanChange,
  activePlan = null,
  fileAccept = ".txt,.md,.docx,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}: MapChatPanelProps) {
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const attachWrapRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const draftInvalid = containsUnsafeDescriptionContent(draft);
  const canSend =
    canAsk &&
    (Boolean(draft.trim()) || Boolean(attachedDocument)) &&
    !draftInvalid &&
    (!followUpRequiresBasePlan || Boolean(basePlanNodeId)) &&
    !busy &&
    !readOnly;
  const canAttach =
    Boolean(onAttachFile || onAttachKecoDocument) && !busy && !readOnly;
  const basePlanOptions = useMemo(() => {
    const options = new Map<string, ActiveMapPlan>();
    if (activePlan) options.set(activePlan.id, activePlan);
    for (const planNode of versionLibrary?.planNodes ?? []) {
      options.set(planNode.id, {
        id: planNode.id,
        label: planNode.displayLabel,
      });
    }
    return [...options.values()];
  }, [activePlan, versionLibrary]);
  const conversationNodes = useMemo(
    () => {
      const nodes = new Map(
        (versionLibrary?.nodes ?? []).map((node) => [node.id, node]),
      );
      for (const planNode of versionLibrary?.planNodes ?? []) {
        nodes.set(planNode.id, planNode);
        for (const mapNode of planNode.maps) nodes.set(mapNode.id, mapNode);
      }
      return nodes;
    },
    [versionLibrary],
  );

  const visibleMessages = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return messages;
    return messages.filter((message) =>
      message.text.toLowerCase().includes(needle),
    );
  }, [messages, query]);
  const firstPendingMessageId = visibleMessages.find(
    (message) => message.pending,
  )?.id;

  useEffect(() => {
    const node = listRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [visibleMessages]);

  useEffect(() => {
    if (!attachMenuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!attachWrapRef.current?.contains(event.target as Node)) {
        setAttachMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAttachMenuOpen(false);
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [attachMenuOpen]);

  const submit = () => {
    if (!canSend) return;
    const prompt = draft.trim();
    setDraft("");
    onAsk(prompt);
  };

  const showSearch = messages.length > 0;
  const hasPlanMessage = messages.some(
    (message) => {
      const artifact = message.artifactNodeId
        ? conversationNodes.get(message.artifactNodeId)
        : null;
      return (
        artifact?.type === "plan" ||
        (message.role === "assistant" &&
          message.text.toLowerCase().includes("map plan"))
      );
    },
  );
  const hasMapMessage = messages.some((message) => {
    const artifact = message.artifactNodeId
      ? conversationNodes.get(message.artifactNodeId)
      : null;
    const text = message.text.toLowerCase();
    return (
      artifact?.type === "map" ||
      (message.role === "assistant" &&
        (text.includes("created map") || text.includes("map generated")))
    );
  });

  const renderMapPlanCard = (
    card: MapPlanCard | null = mapPlan,
    onView: (() => void) | undefined = onViewMapPlan,
    actionLabel = "View map plan",
  ) =>
    card ? (
      <div className={styles.mapResourceCard}>
        <FileTextOutlined
          className={styles.mapPlanDocumentIcon}
          aria-hidden="true"
        />
        <span className={styles.mapResourceCardCopy}>
          <strong>{card.title}</strong>
          <small>{card.versionLabel}</small>
        </span>
        <button
          type="button"
          className={styles.mapResourceAction}
          aria-label={actionLabel}
          title={actionLabel}
          disabled={!onView}
          onClick={onView}
        >
          <Image
            src="/assets/create-map/eye-outline.png"
            alt=""
            width={20}
            height={20}
            aria-hidden="true"
          />
        </button>
      </div>
    ) : null;

  const renderMapImageCard = (
    card: MapImageCard | null = mapImage,
    onView?: () => void,
    actionLabel = "Download map",
  ) =>
    card ? (
      <div className={styles.mapResourceCard}>
        <Image
          src={mapPlanIcon}
          alt=""
          width={22}
          height={22}
          aria-hidden="true"
        />
        <span className={styles.mapResourceCardCopy}>
          <strong>{card.title}</strong>
          <small>{card.versionLabel}</small>
        </span>
        {onView ? (
          <button
            type="button"
            className={styles.mapResourceAction}
            aria-label={actionLabel}
            title={actionLabel}
            onClick={onView}
          >
            <Image
              src="/assets/create-map/eye-outline.png"
              alt=""
              width={20}
              height={20}
              aria-hidden="true"
            />
          </button>
        ) : (
          <a
            className={styles.mapResourceAction}
            aria-label={actionLabel}
            title={actionLabel}
            href={card.downloadUrl}
            download
          >
            <DownloadOutlined aria-hidden="true" />
          </a>
        )}
      </div>
    ) : null;

  return (
    <section className={styles.chatPanel} aria-label="Map conversation">
      <header className={styles.chatHeader}>
        <button
          type="button"
          className={styles.chatBackButton}
          aria-label="Back to saved maps"
          onClick={onBack}
        >
          <ArrowLeftOutlined />
        </button>
        <h2 className={styles.chatTitle}>{mapTitle || "New map"}</h2>
        <div className={styles.chatHeaderActions}>
          <button
            type="button"
            className={styles.chatHeaderIconButton}
            aria-label="Create map"
            title="Create map"
            disabled={readOnly || !onCreate}
            onClick={onCreate}
          >
            <PlusOutlined />
          </button>
          <div className={styles.mapHistoryWrap}>
            <button
              type="button"
              className={styles.chatHeaderIconButton}
              aria-label="Show map generation history"
              aria-expanded={historyOpen}
              aria-controls="map-generation-history"
              title="Map generation history"
              disabled={
                versionLibrary
                  ? basePlanOptions.length === 0
                  : generationHistory.length === 0
              }
              onClick={() => setHistoryOpen((open) => !open)}
            >
              <Image
                className={styles.mapHistoryIcon}
                src="/assets/create-map/map-history.png"
                width={19}
                height={14}
                alt=""
              />
            </button>
            <div
              id="map-generation-history"
              className={styles.mapHistoryMenu}
              hidden={!historyOpen}
              role="menu"
              aria-label="Version library"
            >
              {versionLibrary ? (
                <p className={styles.mapHistoryLabel}>Versions</p>
              ) : (
                <p className={styles.mapHistoryLabel}>Map</p>
              )}
              {versionLibrary?.planNodes.map((planNode) => (
                <div key={planNode.id}>
                  <button
                    type="button"
                    className={styles.mapHistoryItem}
                    role="menuitem"
                    onClick={() => {
                      setHistoryOpen(false);
                      onSelectConversationNode?.(planNode.id);
                    }}
                  >
                    <FileTextOutlined aria-hidden="true" />
                    <span>{planNode.displayLabel}</span>
                  </button>
                  {planNode.maps.map((mapNode) => (
                    <button
                      key={mapNode.id}
                      type="button"
                      className={styles.mapHistoryItem}
                      role="menuitem"
                      onClick={() => {
                        setHistoryOpen(false);
                        onSelectConversationNode?.(mapNode.id);
                      }}
                    >
                      <Image
                        src={mapPlanIcon}
                        width={21}
                        height={21}
                        alt=""
                        aria-hidden="true"
                      />
                      <span>
                        {mapNode.displayLabel} {mapNode.status}
                      </span>
                    </button>
                  ))}
                </div>
              ))}
              {!versionLibrary
                ? generationHistory.map((entry) => (
                    <div
                      key={entry.revisionId}
                      className={
                        entry.isCurrent
                          ? styles.mapHistoryItemCurrent
                          : styles.mapHistoryItem
                      }
                      aria-current={entry.isCurrent || undefined}
                      data-history-version={entry.label}
                    >
                      <Image
                        src={mapPlanIcon}
                        width={21}
                        height={21}
                        alt=""
                        aria-hidden="true"
                      />
                      <span>{entry.label}</span>
                    </div>
                  ))
                : null}
            </div>
          </div>
        </div>
      </header>

      <div className={styles.chatBody} ref={listRef}>
        {messages.length === 0 ? (
          <p className={styles.chatEmpty}>
            Describe the map you want. Keco will create a map plan you can
            review and generate.
          </p>
        ) : null}
        {showSearch ? (
          <label className={styles.chatSearch}>
            <SearchOutlined aria-hidden />
            <input
              type="search"
              placeholder="Search messages..."
              aria-label="Search messages"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        ) : null}
        {visibleMessages.map((message) => {
          const artifact = message.artifactNodeId
            ? conversationNodes.get(message.artifactNodeId)
            : null;
          const planArtifact = artifact?.type === "plan" ? artifact : null;
          const mapArtifact = artifact?.type === "map" ? artifact : null;
          const isPlanMessage =
            Boolean(planArtifact) ||
            (message.role === "assistant" &&
              message.text.toLowerCase().includes("map plan"));
          const isMapMessage =
            (Boolean(mapArtifact) ||
              (message.role === "assistant" &&
                (message.text.toLowerCase().includes("created map") ||
                  message.text.toLowerCase().includes("map generated")))) &&
            !isPlanMessage;
          return (
            <Fragment key={message.id}>
              {message.id === firstPendingMessageId ? (
                <>
                  {!hasPlanMessage ? renderMapPlanCard() : null}
                  {!hasMapMessage ? renderMapImageCard() : null}
                </>
              ) : null}
              <div className={styles.chatMessageGroup}>
                <div
                  className={
                    message.role === "user"
                      ? styles.chatBubbleUser
                      : styles.chatBubbleAssistant
                  }
                >
                  {message.text}
                </div>
                {planArtifact
                  ? renderMapPlanCard(
                      {
                        title: versionLibrary?.title ?? mapTitle,
                        versionLabel: planArtifact.displayLabel,
                      },
                      onSelectConversationNode
                        ? () => onSelectConversationNode(planArtifact.id)
                        : undefined,
                      `View ${planArtifact.displayLabel}`,
                    )
                  : isPlanMessage
                    ? renderMapPlanCard()
                    : null}
                {mapArtifact
                  ? renderMapImageCard(
                      {
                        title: versionLibrary?.title ?? mapTitle,
                        versionLabel: mapArtifact.displayLabel,
                        downloadUrl: mapImage?.downloadUrl ?? "",
                      },
                      onSelectConversationNode
                        ? () => onSelectConversationNode(mapArtifact.id)
                        : undefined,
                      `View ${mapArtifact.displayLabel}`,
                    )
                  : isMapMessage
                    ? renderMapImageCard()
                    : null}
              </div>
            </Fragment>
          );
        })}
        {!firstPendingMessageId && !hasPlanMessage ? renderMapPlanCard() : null}
        {!firstPendingMessageId && !hasMapMessage ? renderMapImageCard() : null}
        {error ? (
          <p className={styles.inlineError} role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <div className={styles.chatComposer}>
        {followUpRequiresBasePlan ? (
          <label className={styles.chatBasePlanPicker}>
            <span>Base Plan</span>
            <select
              aria-label="Base Plan"
              value={basePlanNodeId ?? ""}
              disabled={busy || readOnly}
              onChange={(event) =>
                onBasePlanChange?.(event.target.value || null)
              }
            >
              <option value="">Select a base Plan</option>
              {basePlanOptions.map((planNode) => (
                <option key={planNode.id} value={planNode.id}>
                  {planNode.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {attachedDocument ? (
          <div className={styles.chatAttachmentRow}>
            <span
              className={styles.chatAttachmentChip}
              title={attachedDocument.name}
            >
              <Image
                src={paperIcon}
                alt=""
                width={14}
                height={14}
                aria-hidden="true"
              />
              <span className={styles.chatAttachmentName}>
                {attachedDocument.name}
              </span>
              {onClearAttachedDocument && !readOnly ? (
                <button
                  type="button"
                  className={styles.chatAttachmentRemove}
                  aria-label="Remove attached document"
                  disabled={busy}
                  onClick={onClearAttachedDocument}
                >
                  <CloseOutlined />
                </button>
              ) : null}
            </span>
          </div>
        ) : null}
        <div className={styles.chatInputBar}>
          <textarea
            className={styles.chatInput}
            rows={1}
            placeholder="Ask AI to help..."
            aria-label="Ask AI to help"
            aria-invalid={draftInvalid || undefined}
            value={draft}
            disabled={busy || readOnly}
            maxLength={4000}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
          />
          <div className={styles.chatInputActions}>
            <div className={styles.chatAttachWrap} ref={attachWrapRef}>
              <input
                ref={fileInputRef}
                type="file"
                accept={fileAccept}
                className={styles.chatFileInputHidden}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file || !onAttachFile) return;
                  onAttachFile(file);
                }}
              />
              <button
                type="button"
                className={styles.chatAttachButton}
                disabled={!canAttach}
                aria-label="Attach"
                aria-haspopup="menu"
                aria-expanded={attachMenuOpen}
                title="Attach"
                onClick={() => setAttachMenuOpen((open) => !open)}
              >
                <PlusOutlined />
              </button>
              {attachMenuOpen ? (
                <div
                  className={styles.chatAttachMenu}
                  role="menu"
                  aria-label="Attach options"
                >
                  {onAttachFile ? (
                    <button
                      type="button"
                      className={styles.chatAttachMenuItem}
                      role="menuitem"
                      onClick={() => {
                        setAttachMenuOpen(false);
                        fileInputRef.current?.click();
                      }}
                    >
                      <FileClipIcon />
                      <span>File</span>
                    </button>
                  ) : null}
                  {onAttachKecoDocument ? (
                    <button
                      type="button"
                      className={styles.chatAttachMenuItem}
                      role="menuitem"
                      onClick={() => {
                        setAttachMenuOpen(false);
                        onAttachKecoDocument();
                      }}
                    >
                      <Image
                        src={paperIcon}
                        alt=""
                        width={16}
                        height={16}
                        className={styles.chatAttachMenuIcon}
                        aria-hidden="true"
                      />
                      <span>Keco Document</span>
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className={styles.chatSendButton}
              aria-label="Send"
              disabled={!canSend}
              onClick={submit}
            >
              <ArrowUpOutlined />
            </button>
          </div>
        </div>
        {draftInvalid ? (
          <p className={styles.inlineError} role="alert">
            <strong>Invalid.</strong> {DIRECT_MAP_UNSAFE_DESCRIPTION_MESSAGE}
          </p>
        ) : null}
      </div>
    </section>
  );
}
