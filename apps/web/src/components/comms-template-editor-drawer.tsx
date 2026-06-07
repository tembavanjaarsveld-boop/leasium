"use client";

import { Power, RotateCcw, Save, Trash2 } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { DetailDrawer } from "@/components/detail-drawer";
import {
  Button,
  Field,
  Input,
  SecondaryButton,
  Select,
  StatusBadge,
} from "@/components/ui";
import {
  ApiError,
  type BrandedCommunicationTemplateCreatePayload,
  type BrandedCommunicationTemplateRecord,
  type BrandedCommunicationTemplateUpdatePayload,
} from "@/lib/api";
import { cn, friendlyError } from "@/lib/utils";

const TEMPLATE_KEY_OPTIONS = [
  "invoice_delivery",
  "maintenance_contractor_update",
  "work_assignment_notification",
  "work_assignment_notice",
  "work_assignment_digest",
  "work_assignment_digest_owner_review",
];

const FOOTER_NOTE =
  "Editing or creating a template never sends a message; provider sends stay behind the review-first dispatch queue.";

type TemplateChannel = BrandedCommunicationTemplateRecord["channel"];

const SAMPLE_TEMPLATE_VALUES: Record<string, string> = {
  action_url: "https://leasium.ai/work/maintenance/work-order-1",
  assignee_email: "ops@skjcapital.example",
  assignee_name: "Jordan Miles",
  contractor_name: "Harbour Lane Electrical",
  entity_name: "SKJ Capital",
  invoice_number: "INV-1042",
  invoice_url: "https://leasium.ai/tenants/tenant-1/invoices/invoice-1042",
  owner_name: "SKJ Property Pty Ltd",
  property_name: "Harbour Lane",
  tenant_name: "Rivergum Bakery",
  work_title: "Loading dock light repair",
};

export type CommsTemplateEditorAction =
  | {
      type: "create";
      payload: BrandedCommunicationTemplateCreatePayload;
    }
  | {
      type: "update";
      templateId: string;
      payload: BrandedCommunicationTemplateUpdatePayload;
    }
  | {
      type: "delete";
      templateId: string;
    };

export function CommsTemplateEditorDrawer({
  open,
  mode,
  template,
  entityId,
  onClose,
  onSaved,
}: {
  open: boolean;
  mode: "create" | "edit";
  template: BrandedCommunicationTemplateRecord | null;
  entityId: string | null;
  onClose: () => void;
  onSaved: (action: CommsTemplateEditorAction) => Promise<void>;
}) {
  const keyDatalistId = useId();
  const [key, setKey] = useState("");
  const [version, setVersion] = useState("v1");
  const [channel, setChannel] = useState<TemplateChannel>("email");
  const [provider, setProvider] = useState("sendgrid");
  const [name, setName] = useState("");
  const [subjectTemplate, setSubjectTemplate] = useState("");
  const [bodyTemplate, setBodyTemplate] = useState("");
  const [actionLabel, setActionLabel] = useState("");
  const [actionUrlTemplate, setActionUrlTemplate] = useState("");
  const [notes, setNotes] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setErrorMessage(null);
    setConfirmDelete(false);
    if (mode === "edit" && template) {
      setKey(template.key);
      setVersion(template.version);
      setChannel(template.channel);
      setProvider(template.provider);
      setName(template.name);
      setSubjectTemplate(template.subject_template ?? "");
      setBodyTemplate(template.body_template);
      setActionLabel(template.action_label ?? "");
      setActionUrlTemplate(template.action_url_template ?? "");
      setNotes(template.notes ?? "");
      setIsActive(template.is_active);
      return;
    }
    setKey("");
    setVersion("v1");
    setChannel("email");
    setProvider("sendgrid");
    setName("");
    setSubjectTemplate("");
    setBodyTemplate("");
    setActionLabel("");
    setActionUrlTemplate("");
    setNotes("");
    setIsActive(true);
  }, [mode, open, template]);

  const title =
    mode === "edit" && template
      ? `Edit ${template.name}`
      : "New communication template";
  const saveDisabled =
    isSubmitting ||
    !entityId ||
    !key.trim() ||
    !version.trim() ||
    !provider.trim() ||
    !name.trim() ||
    !bodyTemplate.trim();
  const samplePreview = {
    subject: renderTemplateSample(subjectTemplate),
    body: renderTemplateSample(bodyTemplate),
    actionLabel: renderTemplateSample(actionLabel),
    actionUrl: renderTemplateSample(actionUrlTemplate),
  };

  async function runAction(action: CommsTemplateEditorAction) {
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await onSaved(action);
      onClose();
    } catch (error) {
      setErrorMessage(
        error instanceof ApiError ? error.message : friendlyError(error),
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleChannelChange(nextChannel: TemplateChannel) {
    setChannel(nextChannel);
    setProvider(defaultProviderForChannel(nextChannel));
  }

  function nullableText(value: string) {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  function saveTemplate() {
    if (mode === "create") {
      if (!entityId) return;
      void runAction({
        type: "create",
        payload: {
          entity_id: entityId,
          key: key.trim(),
          version: version.trim(),
          channel,
          provider: provider.trim(),
          name: name.trim(),
          subject_template: nullableText(subjectTemplate),
          body_template: bodyTemplate,
          action_label: nullableText(actionLabel),
          action_url_template: nullableText(actionUrlTemplate),
          notes: nullableText(notes),
          is_active: isActive,
          metadata: {},
        },
      });
      return;
    }

    if (!template) return;
    void runAction({
      type: "update",
      templateId: template.id,
      payload: {
        name: name.trim(),
        subject_template: nullableText(subjectTemplate),
        body_template: bodyTemplate,
        action_label: nullableText(actionLabel),
        action_url_template: nullableText(actionUrlTemplate),
        notes: nullableText(notes),
        is_active: isActive,
        metadata: template.metadata,
      },
    });
  }

  function toggleActive() {
    if (!template) return;
    void runAction({
      type: "update",
      templateId: template.id,
      payload: { is_active: !template.is_active },
    });
  }

  function deleteTemplate() {
    if (!template) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      setErrorMessage(null);
      return;
    }
    void runAction({ type: "delete", templateId: template.id });
  }

  return (
    <DetailDrawer
      open={open}
      title={title}
      description={
        mode === "create"
          ? "Create an operator-owned communication template."
          : "Edit operator-owned fields without changing the template key."
      }
      onClose={onClose}
      testId="comms-template-editor-drawer"
    >
      <div className="grid gap-5">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={isActive ? "success" : "neutral"}>
            {isActive ? "Active" : "Inactive"}
          </StatusBadge>
          {template?.is_system ? (
            <StatusBadge tone="neutral">System</StatusBadge>
          ) : (
            <StatusBadge tone="primary">Operator</StatusBadge>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Key">
            <Input
              value={key}
              list={mode === "create" ? keyDatalistId : undefined}
              readOnly={mode === "edit"}
              onChange={(event) => setKey(event.target.value)}
            />
            {mode === "create" ? (
              <datalist id={keyDatalistId}>
                {TEMPLATE_KEY_OPTIONS.map((option) => (
                  <option key={option} value={option} />
                ))}
              </datalist>
            ) : null}
          </Field>
          <Field label="Version">
            <Input
              value={version}
              readOnly={mode === "edit"}
              onChange={(event) => setVersion(event.target.value)}
            />
          </Field>
          <Field label="Channel">
            <Select
              value={channel}
              disabled={mode === "edit"}
              onChange={(event) =>
                handleChannelChange(event.target.value as TemplateChannel)
              }
            >
              <option value="email">Email</option>
              <option value="sms">SMS</option>
              <option value="in_app">In-app</option>
            </Select>
          </Field>
          <Field label="Provider">
            <Select
              value={provider}
              disabled={mode === "edit"}
              onChange={(event) => setProvider(event.target.value)}
            >
              <option value="sendgrid">SendGrid</option>
              <option value="twilio">Twilio</option>
              <option value="in_app">In-app</option>
            </Select>
          </Field>
        </div>

        <Field label="Name">
          <Input value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="Subject">
          <Input
            value={subjectTemplate}
            onChange={(event) => setSubjectTemplate(event.target.value)}
          />
        </Field>
        <Field label="Body">
          <textarea
            value={bodyTemplate}
            onChange={(event) => setBodyTemplate(event.target.value)}
            className="min-h-40 w-full rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none transition-colors duration-200 ease-leasium focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/15"
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Action label">
            <Input
              value={actionLabel}
              onChange={(event) => setActionLabel(event.target.value)}
            />
          </Field>
          <Field label="Action URL">
            <Input
              value={actionUrlTemplate}
              onChange={(event) => setActionUrlTemplate(event.target.value)}
            />
          </Field>
        </div>
        <section
          aria-label="Sample preview"
          className="grid gap-3 rounded-xl border border-border bg-muted/20 p-3"
          role="region"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase text-muted-foreground">
              Sample preview
            </p>
            <StatusBadge tone="neutral">Review only</StatusBadge>
          </div>
          {samplePreview.subject ? (
            <div className="grid gap-1">
              <p className="text-xs font-medium text-muted-foreground">Subject</p>
              <p className="text-sm font-medium text-foreground">
                {samplePreview.subject}
              </p>
            </div>
          ) : null}
          <div className="grid gap-1">
            <p className="text-xs font-medium text-muted-foreground">Body</p>
            <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">
              {samplePreview.body || "Body preview appears here."}
            </p>
          </div>
          {samplePreview.actionLabel || samplePreview.actionUrl ? (
            <div className="grid gap-1">
              <p className="text-xs font-medium text-muted-foreground">Action</p>
              <p className="text-sm font-medium text-foreground">
                {samplePreview.actionLabel || "Open link"}
              </p>
              {samplePreview.actionUrl ? (
                <p className="break-all text-xs text-muted-foreground">
                  {samplePreview.actionUrl}
                </p>
              ) : null}
            </div>
          ) : null}
        </section>
        <Field label="Notes">
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            className="min-h-24 w-full rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none transition-colors duration-200 ease-leasium focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/15"
          />
        </Field>
        <label className="flex min-h-11 items-center gap-3 rounded-xl border border-border bg-white px-3 text-sm">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(event) => setIsActive(event.target.checked)}
          />
          <span>Active template</span>
        </label>

        {errorMessage ? (
          <p
            role="alert"
            className="rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger"
          >
            {errorMessage}
          </p>
        ) : null}

        <div className="grid gap-3 border-t border-border pt-4">
          <p className="text-xs leading-5 text-muted-foreground">
            {FOOTER_NOTE}
          </p>
          {template?.is_system ? (
            <p className="text-xs text-muted-foreground">
              System templates cannot be deleted; deactivate instead.
            </p>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {mode === "edit" && template ? (
                <SecondaryButton
                  type="button"
                  onClick={toggleActive}
                  disabled={isSubmitting}
                >
                  {template.is_active ? (
                    <Power size={15} />
                  ) : (
                    <RotateCcw size={15} />
                  )}
                  {template.is_active
                    ? "Deactivate template"
                    : "Reactivate template"}
                </SecondaryButton>
              ) : null}
              {mode === "edit" && template && !template.is_system ? (
                <SecondaryButton
                  type="button"
                  onClick={deleteTemplate}
                  disabled={isSubmitting}
                  className={cn(
                    "border-danger/40 text-danger hover:bg-danger/5",
                    confirmDelete ? "bg-danger/5" : null,
                  )}
                >
                  <Trash2 size={15} />
                  {confirmDelete ? "Confirm delete template" : "Delete template"}
                </SecondaryButton>
              ) : null}
            </div>
            <Button type="button" onClick={saveTemplate} disabled={saveDisabled}>
              <Save size={15} />
              Save template
            </Button>
          </div>
        </div>
      </div>
    </DetailDrawer>
  );
}

function defaultProviderForChannel(channel: TemplateChannel) {
  if (channel === "sms") return "twilio";
  if (channel === "in_app") return "in_app";
  return "sendgrid";
}

function renderTemplateSample(value: string) {
  if (!value.trim()) return "";
  return value.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (match, token) => {
    const sample = SAMPLE_TEMPLATE_VALUES[token];
    return sample ?? match;
  });
}
