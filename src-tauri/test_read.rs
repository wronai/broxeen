use std::io::Cursor;
use url::Url;

fn main() {
    let html = "<html><head><title>Test Title</title></head><body><article><h1>Main content</h1><p>This is a test paragraph.</p></article></body></html>";
    let url = Url::parse("https://example.com").unwrap();
    let mut cursor = Cursor::new(html);
    match readability::extractor::extract(&mut cursor, &url) {
        Ok(product) => {
            println!("Title: {}", product.title);
            println!("Text: {}", product.text);
        }
        Err(e) => {
            println!("Error: {}", e);
        }
    }
}
