import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import TtsControls from "./TtsControls";

const baseProps = {
  isSpeaking: false,
  isPaused: false,
  progress: 0,
  onSpeak: vi.fn(),
  onPause: vi.fn(),
  onResume: vi.fn(),
  onStop: vi.fn(),
};

describe("TtsControls", () => {
  it("pokazuje przycisk 'Odsłuchaj' gdy nie mówi", () => {
    render(<TtsControls {...baseProps} />);
    expect(screen.getByText("Odsłuchaj")).toBeInTheDocument();
  });

  it("kliknięcie 'Odsłuchaj' wywołuje onSpeak", () => {
    const onSpeak = vi.fn();
    render(<TtsControls {...baseProps} onSpeak={onSpeak} />);
    fireEvent.click(screen.getByText("Odsłuchaj"));
    expect(onSpeak).toHaveBeenCalledOnce();
  });

  it("pokazuje przycisk Pause gdy mówi i nie jest zatrzymany", () => {
    render(<TtsControls {...baseProps} isSpeaking={true} isPaused={false} />);
    expect(screen.queryByText("Odsłuchaj")).not.toBeInTheDocument();
    expect(screen.getByTitle("Pauza")).toBeInTheDocument();
    expect(screen.getByTitle("Stop")).toBeInTheDocument();
  });

  it("kliknięcie Pause wywołuje onPause", () => {
    const onPause = vi.fn();
    render(
      <TtsControls
        {...baseProps}
        isSpeaking={true}
        isPaused={false}
        onPause={onPause}
      />,
    );
    fireEvent.click(screen.getByTitle("Pauza"));
    expect(onPause).toHaveBeenCalledOnce();
  });

  it("pokazuje przycisk Resume gdy jest zatrzymany", () => {
    render(<TtsControls {...baseProps} isSpeaking={true} isPaused={true} />);
    expect(screen.getByTitle("Wznów")).toBeInTheDocument();
    expect(screen.queryByTitle("Pauza")).not.toBeInTheDocument();
  });

  it("kliknięcie Resume wywołuje onResume", () => {
    const onResume = vi.fn();
    render(
      <TtsControls
        {...baseProps}
        isSpeaking={true}
        isPaused={true}
        onResume={onResume}
      />,
    );
    fireEvent.click(screen.getByTitle("Wznów"));
    expect(onResume).toHaveBeenCalledOnce();
  });

  it("kliknięcie Stop wywołuje onStop", () => {
    const onStop = vi.fn();
    render(
      <TtsControls
        {...baseProps}
        isSpeaking={true}
        isPaused={false}
        onStop={onStop}
      />,
    );
    fireEvent.click(screen.getByTitle("Stop"));
    expect(onStop).toHaveBeenCalledOnce();
  });

  it("pasek postępu ma szerokość odpowiadającą progress", () => {
    const { container } = render(
      <TtsControls {...baseProps} isSpeaking={true} progress={60} />,
    );
    const bar = container.querySelector(".bg-broxeen-400");
    expect(bar).toHaveStyle({ width: "60%" });
  });

  it("pasek postępu nie jest widoczny gdy nie mówi", () => {
    const { container } = render(<TtsControls {...baseProps} isSpeaking={false} />);
    expect(container.querySelector(".bg-broxeen-400")).not.toBeInTheDocument();
  });
});
