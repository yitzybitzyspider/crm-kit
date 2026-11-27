import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import Header from "@/components/atomic-crm/layout/Header";
import { MobileNavigation } from "@/components/atomic-crm/layout/MobileNavigation";
import { CRM } from "@/components/atomic-crm/root/CRM";
import { createDataProvider } from "@/components/atomic-crm/providers/fakerest";
import { testI18nProvider } from "@/components/atomic-crm/providers/commons/i18nProvider";
import {
  buildCompany,
  buildDeal,
  createCrmDb,
  createTestAuthProvider,
  StoryWrapper,
} from "@/test/StoryWrapper";
import { memoryStore } from "ra-core";
import { MemoryRouter } from "react-router";

import { hub } from "./index";
import { buildPerson, buildTouch, hubData } from "./people/testData";

const data = hubData({
  contacts: [buildPerson({ id: 1, status: "contacted" })],
  contact_notes: [buildTouch({ id: 1, contact_id: 1 })],
  companies: [buildCompany({ id: 1 })],
  deals: [buildDeal({ id: 1, company_id: 1 })],
});

// The whole app as App.tsx mounts it, on the fake provider: upstream's test
// wrapper replaces the layout and the landing page, which are what is tested.
const WholeApp = ({ path }: { path: string }) => (
  <MemoryRouter initialEntries={[path]}>
    <CRM
      authProvider={createTestAuthProvider()}
      dataProvider={createDataProvider({ db: createCrmDb(data), silent: true })}
      i18nProvider={testI18nProvider}
      store={memoryStore()}
      disableTelemetry
    />
  </MemoryRouter>
);

describe("the menu and the pages behind it", () => {
  beforeEach(() => {
    page.viewport(1600, 900);
  });

  it("case 9: the menu has People first and no Deals", async () => {
    const screen = await render(
      <StoryWrapper data={data}>
        <Header />
      </StoryWrapper>,
    );

    await expect
      .element(screen.getByRole("link", { name: "People" }))
      .toBeVisible();
    const tabs = [...screen.container.querySelectorAll("header nav a")].map(
      (link) => link.textContent,
    );
    expect(tabs).toEqual([
      "People",
      "Interviews",
      "Inbox",
      "Library",
      "Calendar",
      "Dashboard",
      "Contacts",
      "Companies",
    ]);
    expect(screen.container.textContent).not.toMatch(/deals/i);
  });

  it("case 9: People is the page a teammate lands on", async () => {
    expect(hub.menu[0]).toMatchObject({ label: "People", to: "/" });
    const screen = await render(<WholeApp path="/" />);

    await expect.element(screen.getByTestId("people-board")).toBeVisible();
    await expect
      .element(screen.getByTestId("person-card").getByText("Ada Lovelace"))
      .toBeVisible();
  });

  it("case 9: the dashboard draws with no deals widget", async () => {
    const screen = await render(<WholeApp path="/dashboard" />);

    await expect.element(screen.getByText("Latest Activity")).toBeVisible();
    await expect.element(screen.getByText("Upcoming Tasks")).toBeVisible();
    await expect
      .element(screen.getByText("Upcoming Deal Revenue"))
      .not.toBeInTheDocument();
    expect(
      screen.container.querySelector('[data-testid="people-board"]'),
    ).toBeNull();
  });

  it("issue 24: Interviews and Inbox open from the menu, and a phone's bar keeps to People", async () => {
    const screen = await render(<WholeApp path="/interviews" />);

    await expect
      .element(screen.getByRole("heading", { name: "Interviews" }))
      .toBeVisible();
    await expect.element(screen.getByText("No interview yet.")).toBeVisible();
    await screen.getByRole("link", { name: "Inbox" }).click();
    await expect.element(screen.getByText("Nothing is waiting")).toBeVisible();
    await screen.unmount();

    page.viewport(375, 667);
    const phone = await render(
      <StoryWrapper data={data} initialEntries={["/inbox"]}>
        <MobileNavigation />
      </StoryWrapper>,
    );
    // the page itself opens on a phone, by its address
    await expect.element(phone.getByText("Nothing is waiting")).toBeVisible();
    await phone.unmount();
    const bar = await render(
      <StoryWrapper data={data}>
        <MobileNavigation />
      </StoryWrapper>,
    );
    await expect
      .element(bar.getByRole("link", { name: "People" }))
      .toBeVisible();
    const entries = [...bar.container.querySelectorAll("nav a")].map(
      (link) => link.textContent,
    );
    expect(entries).toContain("People");
    expect(entries).not.toContain("Inbox");
    expect(entries).not.toContain("Interviews");
  });

  it("edge: the address of a deals page typed by hand is not a working deals screen", async () => {
    const screen = await render(<WholeApp path="/deals" />);

    await expect
      .element(screen.getByRole("link", { name: "People" }))
      .toBeVisible();
    await expect.element(screen.getByText("Not Found")).toBeVisible();
    await expect.element(screen.getByText("Acme deal")).not.toBeInTheDocument();
    expect(
      screen.container.querySelector("[data-rfd-droppable-id]"),
    ).toBeNull();

    await screen.unmount();
    const show = await render(<WholeApp path="/deals/1/show" />);
    await expect.element(show.getByText("Not Found")).toBeVisible();
    await expect.element(show.getByText("Acme deal")).not.toBeInTheDocument();
  });
});
