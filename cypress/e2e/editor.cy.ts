/// <reference types="cypress" />

const T = 15000;

// Open a fixture via the demo's file input; force English so text assertions are stable.
function open(fixture: string) {
  cy.visit("/", {
    onBeforeLoad(win) {
      Object.defineProperty(win.navigator, "languages", { value: ["en-US"], configurable: true });
    },
  });
  cy.get("#file").selectFile(fixture, { force: true });
  cy.get(".ge-toolbar", { timeout: T }).should("exist");
}

const handle = () => cy.window().its("geoHandle");

describe("geoedit", () => {
  it("renders a GeoJSON on the map with the editing toolbar", () => {
    open("cypress/fixtures/sample.geojson");
    cy.get(".ge canvas", { timeout: T }).should("exist");
    cy.get('.ge-tool[data-mode="point"]').should("exist");
    cy.get('.ge-tool[data-role="list"]').should("exist");
    cy.get('.ge-tool[data-role="export"]').should("exist");
  });

  it("lists and filters features, and selecting one opens its properties", () => {
    open("cypress/fixtures/sample.geojson");
    cy.get('.ge-tool[data-role="list"]').click();
    cy.get(".ge-litem-name").should("have.length", 2);
    cy.get(".ge-list-filter").type("eta");
    cy.get(".ge-litem-name").should("have.length", 1).and("contain.text", "Beta");
    cy.get(".ge-list-filter").clear();
    cy.contains(".ge-litem-name", "Alpha").click();
    cy.get(".ge-props.is-open input").first().should("have.value", "Alpha");
  });

  it("edits a property byte-losslessly", () => {
    open("cypress/fixtures/sample.geojson");
    cy.get('.ge-tool[data-role="list"]').click();
    cy.contains(".ge-litem-name", "Alpha").click();
    cy.get(".ge-props.is-open input").first().clear().type("Lutece").blur();
    handle()
      .invoke("getText")
      .should((text: string) => {
        expect(text).to.contain('"Lutece"');
        expect(text).to.not.contain('"Alpha"');
        expect(text).to.contain('"pop": 42'); // sibling property untouched
      });
  });

  it("undoes and redoes an edit", () => {
    open("cypress/fixtures/sample.geojson");
    cy.get('.ge-tool[data-role="list"]').click();
    cy.contains(".ge-litem-name", "Beta").click();
    cy.get(".ge-props.is-open input").first().clear().type("Gamma").blur();
    cy.get('.ge-tool[data-hist="undo"]').should("not.be.disabled").click();
    handle().invoke("getText").should("contain", '"Beta"').and("not.contain", "Gamma");
    cy.get('.ge-tool[data-hist="redo"]').click();
    handle().invoke("getText").should("contain", "Gamma");
  });

  it("adds and deletes a property", () => {
    open("cypress/fixtures/sample.geojson");
    cy.get('.ge-tool[data-role="list"]').click();
    cy.contains(".ge-litem-name", "Beta").click();
    cy.get(".ge-addprop input").first().type("color");
    cy.get(".ge-addprop input").eq(1).type("red");
    cy.get(".ge-addprop .ge-btn").click();
    handle().invoke("getText").should("contain", '"color"').and("contain", '"red"');
    cy.get(".ge-props.is-open .ge-row.has-del")
      .contains("label", "color")
      .parent()
      .find(".ge-rowdel")
      .click();
    handle().invoke("getText").should("not.contain", '"color"');
  });

  it("opens the export panel with the three formats", () => {
    open("cypress/fixtures/sample.geojson");
    cy.get('.ge-tool[data-role="export"]').click();
    cy.get(".ge-export .ge-btn").then((btns) => {
      const labels = [...btns].map((b) => b.textContent);
      expect(labels).to.deep.equal(["GEOJSON", "KML", "GPX"]);
    });
  });

  it("opens a KML editable (name + colour), byte-lossless name edit", () => {
    open("cypress/fixtures/sample.kml");
    cy.get('.ge-tool[data-mode="point"]').should("exist"); // editable
    cy.get('.ge-tool[data-role="list"]').click();
    cy.contains(".ge-litem-name", "Eiffel").click();
    cy.get(".ge-props.is-open input[type=color]").should("exist");
    cy.get(".ge-props.is-open input").first().clear().type("Tour Eiffel").blur();
    handle()
      .invoke("getText")
      .should("contain", "<name>Tour Eiffel</name>")
      .and("contain", "<coordinates>2.2945,48.8584,0</coordinates>"); // geometry untouched
  });

  it("opens a TopoJSON view-only", () => {
    open("cypress/fixtures/sample.topojson");
    cy.get(".ge canvas", { timeout: T }).should("exist");
    cy.get(".ge-tool[data-mode]").should("not.exist"); // no draw tools
    cy.get('.ge-tool[data-role="list"]').click();
    cy.get(".ge-litem-name").should("contain.text", "TP");
  });

  it("reads a shapefile zip view-only", () => {
    open("cypress/fixtures/points.zip");
    cy.get(".ge canvas", { timeout: T }).should("exist");
    cy.get(".ge-tool[data-mode]").should("not.exist"); // view-only
    cy.get('.ge-tool[data-role="list"]').click();
    cy.get(".ge-litem-name").should("have.length", 2);
    cy.contains(".ge-litem-name", "Alpha").should("exist");
  });
});
