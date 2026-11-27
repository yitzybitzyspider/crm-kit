import { CircleX, Edit, Save, Trash2 } from "lucide-react";
import {
  Form,
  useDelete,
  useGetIdentity,
  useNotify,
  useResourceContext,
  useTranslate,
  useUpdate,
} from "ra-core";
import { useEffect, useRef, useState } from "react";
import type { FieldValues, SubmitHandler } from "react-hook-form";
import { ReferenceField } from "@/components/admin/reference-field";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { CompanyAvatar } from "../companies/CompanyAvatar";
import { Markdown } from "../misc/Markdown";
import { RelativeDate } from "../misc/RelativeDate";
import { Status } from "../misc/Status";
import type { ContactNote, DealNote } from "../types";
import { NoteAttachments } from "./NoteAttachments";
import { NoteInputs } from "./NoteInputs";
import { useGetSalesName } from "../sales/useGetSalesName";
// team hub: a touch shows its channel and next step, its text as plain
// text, and is never deleted.
import { hub, TouchDetails, TouchText } from "@/components/kit";

export const Note = ({
  showStatus,
  note,
  isCompact,
}: {
  showStatus?: boolean;
  note: DealNote | ContactNote;
  isCompact?: boolean;
}) => {
  const [isHover, setHover] = useState(false);
  const [isEditing, setEditing] = useState(false);
  const [isExpanded, setExpanded] = useState(false);
  const [isTruncated, setTruncated] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const resource = useResourceContext();
  const notify = useNotify();
  const translate = useTranslate();
  const { identity } = useGetIdentity();
  const isCurrentUser = note.sales_id === identity?.id;
  const salesName = useGetSalesName(note.sales_id, {
    enabled: !isCurrentUser,
  });

  const isCollapsedCompact = isCompact && !isExpanded;

  useEffect(() => {
    const el = contentRef.current;
    if (el && !isExpanded) {
      setTruncated(el.scrollHeight > el.clientHeight);
    }
  }, [note.text, isCompact, isExpanded]);

  const [update, { isPending }] = useUpdate();

  const [deleteNote] = useDelete(resource, undefined, {
    mutationMode: "undoable",
    onSuccess: () => {
      notify("resources.notes.deleted", {
        type: "info",
        undoable: true,
        messageArgs: {
          _: "Note deleted",
        },
      });
    },
  });

  const handleDelete = () => {
    deleteNote(resource, { id: note.id, previousData: note });
  };

  const handleEnterEditMode = () => {
    setEditing(!isEditing);
  };

  const handleCancelEdit = () => {
    setEditing(false);
    setHover(false);
  };

  const handleNoteUpdate: SubmitHandler<FieldValues> = (values) => {
    update(
      resource,
      { id: note.id, data: values, previousData: note },
      {
        onSuccess: () => {
          setEditing(false);
          setHover(false);
        },
      },
    );
  };

  const content = (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="mb-4"
      data-testid="touch"
      data-touch-id={note.id}
    >
      <div className="flex items-center space-x-4 w-full">
        <ReferenceField source="company_id" reference="companies" link="show">
          <CompanyAvatar width={20} height={20} />
        </ReferenceField>
        <div className="inline-flex h-full items-center text-sm text-muted-foreground">
          {translate(
            isCurrentUser
              ? "resources.notes.you_added"
              : "resources.notes.author_added",
            { name: salesName },
          )}{" "}
          {showStatus && note.status && (
            <Status className="ml-2" status={note.status} />
          )}
        </div>
        <span className={`${isHover ? "visible" : "invisible"}`}>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleEnterEditMode}
                    className="p-1 h-auto cursor-pointer"
                    aria-label={translate("resources.notes.action.edit")}
                  />
                }
              >
                <Edit className="w-4 h-4" />
              </TooltipTrigger>
              <TooltipContent>
                <p>{translate("resources.notes.action.edit")}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          {hub.shows.delete && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleDelete}
                      className="p-1 h-auto cursor-pointer"
                      aria-label={translate("resources.notes.action.delete")}
                    />
                  }
                >
                  <Trash2 className="w-4 h-4" />
                </TooltipTrigger>
                <TooltipContent>
                  <p>{translate("resources.notes.action.delete")}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </span>
        <div className="flex-1"></div>
        <span className="text-sm text-muted-foreground">
          <RelativeDate date={note.date} />
        </span>
      </div>
      {"contact_id" in note && <TouchDetails touch={note} />}
      {isEditing ? (
        <Form onSubmit={handleNoteUpdate} record={note} className="mt-1">
          <NoteInputs showStatus={showStatus} />
          <div className="flex justify-end mt-2 space-x-4">
            <Button
              variant="ghost"
              onClick={handleCancelEdit}
              type="button"
              className="cursor-pointer"
            >
              <CircleX className="w-4 h-4" />
              {translate("ra.action.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={isPending}
              className="flex items-center gap-2 cursor-pointer"
            >
              <Save className="w-4 h-4" />
              {translate("resources.notes.action.update")}
            </Button>
          </div>
        </Form>
      ) : (
        <div className="pt-2 text-sm max-w-150">
          {note.text &&
            (isCollapsedCompact ? (
              <p ref={contentRef} className="line-clamp-2">
                {note.text.replace(/\s+/g, " ").trim()}
              </p>
            ) : (
              <div
                ref={contentRef}
                className={cn("overflow-hidden", !isExpanded && "max-h-[70vh]")}
              >
                {"contact_id" in note ? (
                  <TouchText>{note.text}</TouchText>
                ) : (
                  <Markdown>{note.text}</Markdown>
                )}
              </div>
            ))}
          {(isTruncated ||
            (isCollapsedCompact &&
              hub.shows.attachments &&
              note.attachments)) && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(!isExpanded);
              }}
              className="text-primary text-sm mt-1 underline hover:no-underline cursor-pointer"
            >
              {isExpanded
                ? translate("crm.common.show_less")
                : translate("crm.common.read_more")}
            </button>
          )}

          {/* team hub, issue 47 item 2: the hub has no attachments, so an
              old entry is not drawn (its src was never checked). */}
          {hub.shows.attachments && note.attachments && !isCollapsedCompact && (
            <NoteAttachments note={note} />
          )}
        </div>
      )}
    </div>
  );

  return content;
};
