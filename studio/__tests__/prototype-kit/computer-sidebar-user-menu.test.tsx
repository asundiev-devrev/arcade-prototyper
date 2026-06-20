// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Avatar, Menu } from "@xorkavi/arcade-gen";
import { ComputerSidebar } from "../../prototype-kit/composites/ComputerSidebar";

afterEach(() => cleanup());

const avatar = <Avatar name="Ava Wright" size="sm" />;

describe("ComputerSidebar.User avatar menu", () => {
  it("renders no menu trigger when `menu` is omitted (backward compatible)", () => {
    render(<ComputerSidebar.User avatar={avatar} name="Ava Wright" subtitle="Maple" />);
    // No account-menu trigger button in the DOM.
    expect(screen.queryByRole("button", { name: /account menu/i })).toBeNull();
  });

  it("opens a menu from the avatar when `menu` is provided", async () => {
    const user = userEvent.setup();
    render(
      <ComputerSidebar.User
        avatar={avatar}
        name="Ava Wright"
        subtitle="Maple"
        menu={
          <>
            <Menu.Item>Settings</Menu.Item>
            <Menu.Separator />
            <Menu.Item>Log out</Menu.Item>
          </>
        }
      />,
    );
    const trigger = screen.getByRole("button", { name: /account menu/i });
    await user.click(trigger);
    expect(screen.getByText("Settings")).toBeTruthy();
    expect(screen.getByText("Log out")).toBeTruthy();
  });
});
