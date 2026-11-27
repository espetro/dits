import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { IntlProvider } from "react-intl";

import en from "../locales/en.json";
import { ModelCombobox } from "./model-combobox";
import type { ModelComboboxProps } from "./model-combobox";

afterEach(cleanup);

const IDS = ["gpt-4o", "gpt-4o-mini", "claude-sonnet"];

function Harness(props: Partial<ModelComboboxProps> & { initial?: string }) {
  const [value, setValue] = React.useState(props.initial ?? "");
  return (
    <IntlProvider locale="en" messages={en as Record<string, string>}>
      <ModelCombobox
        id="llm-model"
        value={value}
        onChange={(v) => {
          setValue(v);
          props.onChange?.(v);
        }}
        options={props.options ?? IDS}
        loading={props.loading ?? false}
        error={props.error ?? null}
        probeable={props.probeable ?? true}
      />
    </IntlProvider>
  );
}

const input = () => screen.getByRole("combobox");
const options = () => screen.queryAllByRole("option");

describe("ModelCombobox", () => {
  it("opens on focus with every model, even when the value is already set", () => {
    render(<Harness initial="gpt-4o" />);
    fireEvent.focus(input());
    expect(input().getAttribute("aria-expanded")).toBe("true");
    expect(options().map((o) => o.textContent)).toEqual(IDS);
  });

  it("opens from the chevron button and toggles closed", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "show models" }));
    expect(options()).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "show models" }));
    expect(input().getAttribute("aria-expanded")).toBe("false");
  });

  it("filters only once the user types, and keeps free text", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: "mini" } });
    expect(options().map((o) => o.textContent)).toEqual(["gpt-4o-mini"]);
    fireEvent.change(input(), { target: { value: "my-custom-model" } });
    expect(onChange).toHaveBeenLastCalledWith("my-custom-model");
    expect(screen.getByRole("status").textContent).toContain("your text is used as typed");
  });

  it("supports arrows, enter and escape", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(input().getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(input().getAttribute("aria-activedescendant")).toBe("llm-model-opt-1");
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith("gpt-4o-mini");
    expect(input().getAttribute("aria-expanded")).toBe("false");
    fireEvent.keyDown(input(), { key: "ArrowUp" });
    expect(input().getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(input().getAttribute("aria-expanded")).toBe("false");
  });

  it("picks an option by click", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.focus(input());
    fireEvent.click(screen.getByRole("option", { name: "claude-sonnet" }));
    expect(onChange).toHaveBeenCalledWith("claude-sonnet");
    expect((input() as HTMLInputElement).value).toBe("claude-sonnet");
  });

  it("renders the loading state inside the list", () => {
    render(<Harness options={[]} loading />);
    fireEvent.focus(input());
    expect(screen.getByRole("status").textContent).toContain("loading models...");
  });

  it("renders the empty state inside the list", () => {
    render(<Harness options={[]} />);
    fireEvent.focus(input());
    expect(screen.getByRole("status").textContent).toContain("no models returned by this endpoint");
  });

  it("renders the probe error reason (with the suggestion) inside the list", () => {
    render(
      <Harness options={[]} error="no model list at this base URL; this one works: https://x/v1" />,
    );
    fireEvent.focus(input());
    expect(screen.getByRole("alert").textContent).toContain("https://x/v1");
  });

  it("hints to enter a base url when there is nothing to probe", () => {
    render(<Harness options={[]} probeable={false} />);
    fireEvent.focus(input());
    expect(screen.getByRole("status").textContent).toContain("enter a base URL");
  });

  it("exposes combobox and listbox roles wired by aria-controls", () => {
    render(<Harness />);
    fireEvent.focus(input());
    const list = screen.getByRole("listbox");
    expect(input().getAttribute("aria-controls")).toBe(list.id);
    expect(input().getAttribute("aria-autocomplete")).toBe("list");
  });
});
