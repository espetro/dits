import * as React from "react";
import { useIntl } from "react-intl";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import { cn } from "cn";

import { Input } from "./vendor/input";

export interface ModelComboboxProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** model ids from the endpoint's /models list */
  options: string[];
  /** a /models probe is pending or in flight */
  loading: boolean;
  /** localized probe failure reason (includes the base url suggestion); null when fine */
  error: string | null;
  /** false until there is a usable base url to probe */
  probeable: boolean;
  placeholder?: string;
}

/**
 * Free-text model id input with a real dropdown of the endpoint's models.
 * Typing any id is always allowed. Focus or the chevron opens the full list
 * (unfiltered); the list only narrows once the user types. Loading, empty
 * and error states render inside the open list so the field never looks
 * dead. Replaces the native datalist, which has no visible affordance in
 * many browsers/webviews and says nothing about why it is empty.
 */
export function ModelCombobox(props: ModelComboboxProps) {
  const intl = useIntl();
  const { options, value } = props;
  const rootRef = React.useRef<HTMLDivElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);
  const [open, setOpen] = React.useState(false);
  // the list narrows only after the user types; opening shows everything
  const [typed, setTyped] = React.useState(false);
  const [active, setActive] = React.useState(-1);
  const listId = `${props.id}-listbox`;

  const visible = React.useMemo(() => {
    const q = value.trim().toLowerCase();
    return typed && q ? options.filter((id) => id.toLowerCase().includes(q)) : options;
  }, [options, value, typed]);

  const show = React.useCallback(() => {
    setOpen(true);
    setTyped(false);
    setActive(options.indexOf(value));
  }, [options, value]);

  const close = React.useCallback(() => {
    setOpen(false);
    setActive(-1);
  }, []);

  const pick = (id: string) => {
    props.onChange(id);
    setTyped(false);
    close();
  };

  // Escape closes the list only: a window-level capture listener runs before
  // the settings dialog's document-level Escape handler, so the dialog stays.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !rootRef.current?.contains(e.target as Node)) return;
      e.stopPropagation();
      e.preventDefault();
      close();
    };
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open, close]);

  React.useEffect(() => {
    if (!open || active < 0) return;
    listRef.current?.children[active]?.scrollIntoView?.({ block: "nearest" });
  }, [open, active]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        show();
        return;
      }
      const n = visible.length;
      if (n === 0) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((a) => (a + step + n) % n);
    } else if (e.key === "Enter" && open && active >= 0 && visible[active] !== undefined) {
      e.preventDefault();
      pick(visible[active]);
    }
  };

  const activeId = open && active >= 0 ? `${props.id}-opt-${active}` : undefined;
  const empty = visible.length === 0;
  let status: { text: string; tone: "muted" | "error"; spinner?: boolean } | null = null;
  if (empty) {
    if (props.loading) {
      status = {
        text: intl.formatMessage({ id: "settings.modelsLoading" }),
        tone: "muted",
        spinner: true,
      };
    } else if (props.error) {
      status = { text: props.error, tone: "error" };
    } else if (!props.probeable) {
      status = { text: intl.formatMessage({ id: "settings.modelsIdle" }), tone: "muted" };
    } else if (options.length > 0) {
      status = { text: intl.formatMessage({ id: "settings.modelsNoMatch" }), tone: "muted" };
    } else {
      status = { text: intl.formatMessage({ id: "settings.modelsEmpty" }), tone: "muted" };
    }
  }

  return (
    <div
      ref={rootRef}
      className="relative"
      onBlur={(e) => {
        if (!rootRef.current?.contains(e.relatedTarget as Node | null)) close();
      }}
    >
      <Input
        id={props.id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        autoComplete="off"
        spellCheck={false}
        value={value}
        placeholder={props.placeholder}
        className="pr-9"
        onChange={(e) => {
          props.onChange(e.target.value);
          setTyped(true);
          setActive(-1);
          setOpen(true);
        }}
        onFocus={show}
        onClick={() => {
          if (!open) show();
        }}
        onKeyDown={onKeyDown}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label={intl.formatMessage({ id: "settings.modelsToggle" })}
        aria-controls={listId}
        aria-expanded={open}
        // keep focus in the input so the blur handler does not race the click
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => (open ? close() : show())}
        className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
      >
        {props.loading ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <ChevronDown
            className={cn("size-4 transition-transform", open && "rotate-180")}
            aria-hidden="true"
          />
        )}
      </button>
      <div
        id={listId}
        role="listbox"
        aria-label={intl.formatMessage({ id: "settings.modelId" })}
        aria-busy={props.loading}
        hidden={!open}
        className="absolute inset-x-0 top-full z-50 mt-1 overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md"
      >
        <ul ref={listRef} className="max-h-60 overflow-y-auto p-1">
          {visible.map((id, i) => (
            <li
              key={id}
              id={`${props.id}-opt-${i}`}
              role="option"
              aria-selected={id === value}
              data-active={i === active || undefined}
              onMouseDown={(e) => e.preventDefault()}
              onMouseMove={() => setActive(i)}
              onClick={() => pick(id)}
              className="flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm select-none data-[active]:bg-accent data-[active]:text-accent-foreground"
            >
              <span className="min-w-0 flex-1 truncate">{id}</span>
              {id === value && <Check className="size-4 shrink-0" aria-hidden="true" />}
            </li>
          ))}
        </ul>
        {status && (
          <div
            role={status.tone === "error" ? "alert" : "status"}
            className={cn(
              "flex items-start gap-2 px-3 py-2 text-xs",
              status.tone === "error" ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {status.spinner && (
              <Loader2 className="mt-0.5 size-3 animate-spin" aria-hidden="true" />
            )}
            <span className="min-w-0 break-words">{status.text}</span>
          </div>
        )}
      </div>
    </div>
  );
}
