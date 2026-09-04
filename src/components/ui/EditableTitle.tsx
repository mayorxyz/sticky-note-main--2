import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";

interface Props {
  text: string;
  onSave: (text: string) => void;
  className?: string;
  inputClassName?: string;
}

export function EditableTitle({ text, onSave, className = "", inputClassName = "" }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  useEffect(() => {
    if (!editing) setDraft(text);
  }, [text, editing]);

  function beginEditing(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    setDraft(text);
    setEditing(true);
  }

  function save(event?: MouseEvent | KeyboardEvent) {
    event?.preventDefault();
    event?.stopPropagation();
    const nextTitle = draft.trim();
    if (nextTitle && nextTitle !== text) onSave(nextTitle);
    setEditing(false);
  }

  function cancel(event?: MouseEvent | KeyboardEvent) {
    event?.preventDefault();
    event?.stopPropagation();
    setDraft(text);
    setEditing(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") save(event);
    if (event.key === "Escape") cancel(event);
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        className={inputClassName}
        aria-label="Rename document"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => save()}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      />
    );
  }

  return (
    <button
      type="button"
      className={`cursor-text text-left ${className}`}
      onClick={beginEditing}
      title="Click to rename"
      aria-label={`Rename ${text}`}
    >
      {text}
    </button>
  );
}
