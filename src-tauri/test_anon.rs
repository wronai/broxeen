fn main() {
    let url = "rtsp://admin:Tom4Camera@192.168.188.176:554/Streaming/Channels/102";
    let anonymized = broxeen::network_scan::anonymize_rtsp_url(url);
    println!("Original: {}", url);
    println!("Anonymized: {}", anonymized);
}
