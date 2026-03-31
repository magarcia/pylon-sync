import { describe, it, expect, beforeEach } from "vitest";
import { StatusBar } from "../ui/status-bar";

function createMockElement(): HTMLElement {
  const el = {
    text: "",
    setText(t: string) {
      this.text = t;
    },
    getText() {
      return this.text;
    },
  };
  return el as unknown as HTMLElement;
}

describe("StatusBar", () => {
  let el: HTMLElement;
  let bar: StatusBar;

  beforeEach(() => {
    el = createMockElement();
    bar = new StatusBar(el);
  });

  describe("update", () => {
    it('should show "Pylon Sync" when idle with no lastSyncTime', () => {
      bar.update("idle");

      expect((el as any).text).toBe("Pylon Sync");
    });

    it('should show "Synced" when idle with lastSyncTime set', () => {
      bar.setLastSyncTime(Date.now());
      bar.update("idle");

      expect((el as any).text).toBe("Synced");
    });

    it('should show "Syncing..." when syncing', () => {
      bar.update("syncing");

      expect((el as any).text).toBe("Syncing...");
    });

    it('should show "Sync pending..." when debouncing', () => {
      bar.update("debouncing");

      expect((el as any).text).toBe("Sync pending...");
    });

    it('should show "Sync error" when error', () => {
      bar.update("error");

      expect((el as any).text).toBe("Sync error");
    });
  });

  describe("setFileStatus", () => {
    it("should append checkmark indicator for synced", () => {
      bar.update("idle");
      bar.setFileStatus("synced");

      expect((el as any).text).toContain("\u2713");
    });

    it("should append dot indicator for modified", () => {
      bar.update("idle");
      bar.setFileStatus("modified");

      expect((el as any).text).toContain("\u25CF");
    });

    it("should append plus indicator for new", () => {
      bar.update("idle");
      bar.setFileStatus("new");

      expect((el as any).text).toContain("+");
    });
  });
});
