/**
 * A test stand-in for the browser's EventSource: the mocked `streamAutonomousRun` records its
 * callback here so a test can emit server frames without a real server.
 */
export class ServerSentEvent {
  static last: { emit: (event: any) => void; close: () => void } | null = null;

  constructor(private onEvent: (event: any) => void) {
    ServerSentEvent.last = {
      emit: (event) => this.onEvent(event),
      close: () => {}
    };
  }

  emit(event: any): void {
    this.onEvent(event);
  }

  close(): void {}
}
