use base64::{Engine as _, engine::general_purpose::STANDARD};
use criterion::{Criterion, criterion_group, criterion_main};
use stepbit::terminal::TerminalOutputProcessor;

fn bench_terminal_output_processor(c: &mut Criterion) {
    let encoded = STANDARD.encode("/Users/joelguerra/Projects/ai_tools/stepbit-labs/stepbit-ui");
    let mixed_output = format!(
        "pwd\r\n/Users/joelguerra/Projects/ai_tools/stepbit-labs\r\n\x1b]633;P;Cwd={encoded}\x07ls\r\nsrc\r\nfrontend\r\n"
    );

    c.bench_function("terminal_output_processor_mixed_stream", |b| {
        b.iter(|| {
            let mut processor = TerminalOutputProcessor::new();
            let processed = processor.process_chunk(mixed_output.as_bytes());
            std::hint::black_box(processed.display.len());
            std::hint::black_box(processed.update.cwd.as_deref());
        });
    });
}

criterion_group!(benches, bench_terminal_output_processor);
criterion_main!(benches);
