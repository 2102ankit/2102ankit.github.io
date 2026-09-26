---
title: "The Anatomy of a Web Request"
description: "The full lifecycle of a web request, from DNS over UDP to pixels on your screen"
date: 2026-09-26
show: true
---

You type `google.com`, press Enter, and the page appears in under a second. Behind that second sits a relay race run by roughly a dozen systems: your browser, a DNS resolver speaking [UDP](https://en.wikipedia.org/wiki/User_Datagram_Protocol), your home router rewriting addresses with [NAT](https://en.wikipedia.org/wiki/Network_address_translation), a [TCP](https://en.wikipedia.org/wiki/Transmission_Control_Protocol) handshake across the internet, a [TLS](https://en.wikipedia.org/wiki/Transport_Layer_Security) negotiation, an [nginx](https://nginx.org/en/docs/http/ngx_http_proxy_module.html) reverse proxy on port 443, an app server juggling your connection among tens of thousands of others with [epoll](https://man7.org/linux/man-pages/man7/epoll.7.html), and finally your browser turning bytes into painted pixels.

Every layer exists to answer one question. DNS answers *where*, TCP answers *did it arrive*, TLS answers *who am I talking to*, HTTP answers *what do I want*, and the browser answers *what does the user see*. When something breaks, identifying which question went unanswered tells you which layer to blame.

This post walks the whole journey in order: leaving your machine, crossing the internet, being served, coming back, and getting painted. Each section names the protocol and the port and shows the exact bytes where it matters. Scattered through are commands you can run to watch it happen, and failure signatures for the layers where I have earned opinions about them.

## 0. Before anything leaves: parsing the URL

The browser first turns your keystrokes into a structured request. `google.com` is not a complete address: the browser fills in the blanks:

```text
https://www.google.com/   (browsers default to https)
  └── scheme: https → port 443, TLS required
  └── host:   www.google.com (bare domain 301s here)
  └── path:   / (defaults to root)
```

Three things happen before any network I/O, all cheap and all local. The browser decides this is a URL and not a search query (a single word with no spaces and a known public suffix resolves as a URL). It checks the [HSTS](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security) preload list, where `google.com` is listed, so it goes straight to HTTPS on port 443 and never attempts plain `http://` first. Then it checks its memory cache, disk cache, and any registered [service worker](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API) for a fresh copy. On a cold visit all three miss, and the real journey begins with the one question nothing else can proceed without: what IP address is `www.google.com`?

## 1. DNS: the phone book lookup, over UDP

Nothing on the internet routes by name. Every packet needs a destination IP, so the browser asks the system's configured [stub resolver](https://en.wikipedia.org/wiki/Name_server#Authoritative_name_server). That address usually comes from your router over DHCP, and it is often the router itself forwarding to your ISP. If the OS cache has no fresh entry, a recursive query goes out to a full resolver (your ISP's, or `8.8.8.8` / `1.1.1.1`).

DNS classically rides on [UDP](https://en.wikipedia.org/wiki/User_Datagram_Protocol) port 53: one question datagram, one answer datagram, no handshake. That is the whole point: a name lookup must be cheaper than the connection it enables, and TCP's three-packet handshake would triple the cost of every lookup. The trade is reliability: UDP can drop or reorder, so the resolver sets a timeout (typically ~2–5 seconds) and retries, possibly over TCP.

<figure>
  <svg viewBox="0 0 640 270" role="img" aria-label="DNS resolution chain from browser cache through stub resolver, recursive resolver, root, TLD and authoritative servers">
    <g font-size="12" style="fill:var(--muted);">
      <rect x="14" y="60" width="106" height="70" rx="10" style="fill:none;stroke:var(--fainter);stroke-width:1.5;"/>
      <text x="67" y="88" text-anchor="middle" font-weight="600" style="fill:var(--fg);">browser</text>
      <text x="67" y="106" text-anchor="middle">cache miss</text>
      <rect x="132" y="60" width="106" height="70" rx="10" style="fill:none;stroke:var(--fainter);stroke-width:1.5;"/>
      <text x="185" y="88" text-anchor="middle" font-weight="600" style="fill:var(--fg);">OS + router</text>
      <text x="185" y="106" text-anchor="middle">cache miss</text>
      <rect x="250" y="60" width="120" height="70" rx="10" style="fill:none;stroke:var(--accent);stroke-width:2;"/>
      <text x="310" y="88" text-anchor="middle" font-weight="600" style="fill:var(--fg);">resolver</text>
      <text x="310" y="106" text-anchor="middle">recurses</text>
      <rect x="440" y="18" width="150" height="38" rx="8" style="fill:none;stroke:var(--fainter);stroke-width:1.5;"/>
      <text x="515" y="42" text-anchor="middle">root (.)</text>
      <rect x="440" y="66" width="150" height="38" rx="8" style="fill:none;stroke:var(--fainter);stroke-width:1.5;"/>
      <text x="515" y="90" text-anchor="middle">TLD (.com)</text>
      <rect x="440" y="114" width="150" height="38" rx="8" style="fill:var(--accent-soft);stroke:var(--accent);stroke-width:1.5;"/>
      <text x="515" y="138" text-anchor="middle">authoritative</text>
    </g>
    <line x1="120" y1="95" x2="130" y2="95" stroke-width="1.5" style="stroke:var(--faint);"/>
    <polygon points="130,95 124,92 124,98" style="fill:var(--faint);"/>
    <line x1="238" y1="95" x2="248" y2="95" stroke-width="1.5" style="stroke:var(--faint);"/>
    <polygon points="248,95 242,92 242,98" style="fill:var(--faint);"/>
    <path d="M370,76 H396 V37 H438" fill="none" stroke-width="1.5" style="stroke:var(--faint);"/>
    <polygon points="438,37 432,34 432,40" style="fill:var(--faint);"/>
    <line x1="370" y1="95" x2="438" y2="95" stroke-width="1.5" style="stroke:var(--faint);"/>
    <polygon points="438,95 432,92 432,98" style="fill:var(--faint);"/>
    <path d="M370,114 H404 V141 H438" fill="none" stroke-width="1.5" style="stroke:var(--accent);"/>
    <polygon points="438,141 432,138 432,144" style="fill:var(--accent);"/>
    <text x="320" y="188" text-anchor="middle" font-size="12" style="fill:var(--faint);">each answer is cached with a TTL; the next visitor skips the whole chain</text>
    <text x="320" y="210" text-anchor="middle" font-size="12" style="fill:var(--faint);">one UDP question, one UDP answer per hop (TCP only on truncation)</text>
    <text x="320" y="232" text-anchor="middle" font-size="12" style="fill:var(--faint);">root refers to TLD, TLD refers down, the resolver follows</text>
  </svg>
  <figcaption>DNS resolves by referral: each server answers "I don't know, but ask them."</figcaption>
</figure>

The recursion walks down the hierarchy. The resolver asks a root server (one of 13 logical addresses baked into every resolver), which replies with the `.com` [TLD](https://en.wikipedia.org/wiki/Top-level_domain) servers. The TLD server replies with Google's [authoritative](https://en.wikipedia.org/wiki/Name_server#Authoritative_name_server) servers. The authoritative server finally answers: `www.google.com → 142.250.x.x` (an `A` record; `AAAA` for IPv6). Every reply carries a [TTL](https://en.wikipedia.org/wiki/Time_to_live), and every layer caches it (browser, OS, router, ISP resolver), so the next lookup for the same name costs zero packets.

UDP answers were historically capped at 512 bytes. A longer answer (many records, DNSSEC signatures) sets the truncation bit and the client retries over TCP. [EDNS0](https://en.wikipedia.org/wiki/Extension_Mechanisms_for_DNS) raised the practical ceiling to around 4096 bytes, so TCP fallback is rare but real. Classic DNS is also unencrypted, so anyone on the path sees your queries. [DNS-over-HTTPS](https://en.wikipedia.org/wiki/DNS_over_HTTPS) (port 443) and [DNS-over-TLS](https://en.wikipedia.org/wiki/DNS_over_TLS) (port 853) fix that privacy hole by tunneling the same protocol inside encrypted connections; the lookup logic is unchanged.

```bash
dig +trace www.google.com

# cached answer, for comparison
dig www.google.com @1.1.1.1
```

When this layer breaks, the error usually names it. `NXDOMAIN` means the name does not exist: a typo, an expired registration, or a search-domain suffix getting appended where it should not. A timeout or `SERVFAIL` means the query never completed, which points at the resolver or the path to it. Captive Wi-Fi portals break DNS first and web pages second, so a fresh hotel network failing here is normal, not evidence.

The stale-cache case is the one that has personally cost me a day. After a site migration, half an office loaded the old version for hours while every check I ran showed the shiny new DNS. The culprit was the *old* record's 86400-second TTL, set months earlier by someone who was not thinking about moving. The fix was waiting it out. The lesson I kept was to lower TTLs a day *before* a migration, never during. Flush the local cache while you wait (`ipconfig /flushdns` on Windows, `resolvectl flush-caches` on most Linux, `dscacheutil -flushcache` on macOS), but know the stale copy might live upstream of you.

The resolver answer usually contains both `A` (IPv4) and `AAAA` (IPv6) records. Modern browsers run [Happy Eyeballs](https://en.wikipedia.org/wiki/Happy_Eyeballs): they race both address families with a slight head start for IPv6 (~250ms) and use whichever connects first, so a broken IPv6 path never stalls the page.

## 2. Leaving the machine: ARP, routing, and NAT

The browser now has a destination IP, say `142.250.72.4`, and hands the OS a request to connect. Before a single byte reaches the internet, three local chores run.

**Routing.** The kernel consults the routing table. The destination is not on the LAN, so the packet goes via the default gateway, your home router at something like `192.168.1.1`. The kernel picks the source IP of the LAN interface and an unused ephemeral source port (typically 49152–65535).

**ARP.** An IP packet cannot travel over Wi-Fi or Ethernet without a link-layer destination, so the kernel needs the router's MAC address. It asks with [ARP](https://en.wikipedia.org/wiki/Address_Resolution_Protocol) (IPv6 uses [NDP](https://en.wikipedia.org/wiki/Neighbor_Discovery_Protocol)): a broadcast "who has 192.168.1.1?", one unicast reply, cached for minutes. Only then is the first real packet framed and transmitted.

**NAT: borrowing a public identity.** Your laptop's `192.168.1.x` address is [private](https://en.wikipedia.org/wiki/Private_network) and unroutable on the internet, so the home router performs source [NAT](https://en.wikipedia.org/wiki/Network_address_translation) (masquerading). It rewrites the packet's source to its own public IP and a fresh public source port, and records the mapping in its connection-tracking table. The mapping is keyed on the full 5-tuple (protocol, source IP, source port, destination IP, destination port), which is how the router demultiplexes replies to the right device when several laptops share one public address. Return packets get the reverse rewrite before delivery.

ISPs short of IPv4 space stack a second layer ([CGNAT](https://en.wikipedia.org/wiki/Carrier-grade_NAT)) behind the first. Same mechanism, one more table. Note the side effect: an inbound packet with no matching entry is dropped, so NAT accidentally firewalls your LAN from unsolicited internet traffic. Hop 1 of a traceroute is your gateway, which makes this whole section observable:

```bash
traceroute -n 142.250.72.4
arp -a
```

Failures here look like plumbing problems, not website problems, and the memorable ones are always the gateway. My favorite was a "the internet is down" report that turned out to be two routers chained together: the ISP box feeding a personal router, double NAT, everything superficially fine until anything needing inbound traffic quietly died. "No route to host" is the cleaner version of the same story and means the gateway or route is missing. If the gateway answers ARP but nothing beyond it responds, the fault sits between your router and the ISP.

## 3. TCP: the reliable pipe

IP delivers best-effort datagrams: they can be lost, duplicated, or reordered. [TCP](https://en.wikipedia.org/wiki/Transmission_Control_Protocol) builds a reliable, ordered, bidirectional byte stream on top of that chaos, and it starts with the famous three-way handshake to port 443:

```text
you :52344                  google :443
  │── SYN ────────►│  seq=x: want to talk, starting at x
  │◄── SYN-ACK ────│  seq=y, ack=x+1: ok, I start at y, got x
  │── ACK ────────►│  ack=y+1: got y, pipe is open
```

Each side announces an initial sequence number (randomized, so old duplicate packets can't corrupt the new stream and attackers can't easily spoof it) and acknowledges the other's. Sequence numbers thereafter count every byte, which is what makes loss detection possible: a gap in the sequence means something went missing. The handshake also negotiates the [MSS](https://en.wikipedia.org/wiki/Maximum_segment_size) (largest segment each side will accept, derived from the MTU minus headers) and window scaling for high-bandwidth paths.

<figure>
  <svg viewBox="0 0 640 230" role="img" aria-label="TCP three-way handshake sequence diagram between client and server">
    <text x="170" y="26" text-anchor="middle" font-size="13" font-weight="600" style="fill:var(--fg);">you :52344</text>
    <text x="470" y="26" text-anchor="middle" font-size="13" font-weight="600" style="fill:var(--fg);">google :443</text>
    <line x1="170" y1="36" x2="170" y2="200" stroke-width="1.5" style="stroke:var(--fainter);"/>
    <line x1="470" y1="36" x2="470" y2="200" stroke-width="1.5" style="stroke:var(--fainter);"/>
    <line x1="170" y1="70" x2="470" y2="70" stroke-width="2" style="stroke:var(--accent);"/>
    <polygon points="470,70 460,65 460,75" style="fill:var(--accent);"/>
    <text x="320" y="62" text-anchor="middle" font-size="12" style="fill:var(--muted);">SYN · seq=x</text>
    <line x1="470" y1="120" x2="170" y2="120" stroke-width="2" style="stroke:var(--accent);"/>
    <polygon points="170,120 180,115 180,125" style="fill:var(--accent);"/>
    <text x="320" y="112" text-anchor="middle" font-size="12" style="fill:var(--muted);">SYN-ACK · seq=y · ack=x+1</text>
    <line x1="170" y1="170" x2="470" y2="170" stroke-width="2" style="stroke:var(--accent);"/>
    <polygon points="470,170 460,165 460,175" style="fill:var(--accent);"/>
    <text x="320" y="162" text-anchor="middle" font-size="12" style="fill:var(--muted);">ACK · ack=y+1  →  pipe open</text>
    <text x="320" y="212" text-anchor="middle" font-size="12" style="fill:var(--faint);">one round trip spent before a single byte of real data flows</text>
  </svg>
  <figcaption>Three packets synchronize both directions before anything useful is sent.</figcaption>
</figure>

Between you and Google the packets hop across routers, each forwarding by longest-prefix match, possibly across [autonomous systems](https://en.wikipedia.org/wiki/Autonomous_system_(Internet)) whose borders speak [BGP](https://en.wikipedia.org/wiki/Border_Gateway_Protocol). Oversized packets are fragmented to fit each link's [MTU](https://en.wikipedia.org/wiki/Maximum_transmission_unit) (1500 bytes on Ethernet) and reassembled at the destination. That reassembly cost is one reason both endpoints clamp their segment size up front.

Servers harden this step because SYNs are cheap to forge: a flood of SYNs with spoofed sources once filled server memory with half-open connections ([SYN flood](https://en.wikipedia.org/wiki/SYN_flood)). Modern kernels answer with [SYN cookies](https://en.wikipedia.org/wiki/SYN_cookies), encoding the connection state into the sequence number itself so nothing is stored until the client proves itself with the final ACK. Two commands cover most of the debugging you will ever do at this layer:

```bash
ss -tn state syn-sent
curl -v -w "connect:%{time_connect} tls:%{time_appconnect}\n" \
  https://www.google.com -o /dev/null
```

A connection stuck in `SYN-SENT` tells you exactly where to look. A SYN answered by RST means the host is alive but the port is closed. Silence until timeout means the SYN is being dropped (a firewall) or the host is down. Same hanging page, three different culprits, distinguishable from one command.

## 4. TLS: proving identity, then whispering

TCP gives you a pipe to *someone*. [TLS](https://en.wikipedia.org/wiki/Transport_Layer_Security) answers two harder questions: is that someone really Google, and can anyone eavesdrop? Version 1.3 completes this in a single round trip:

```text
you                        google
  │── ClientHello ──►│  SNI, ALPN, cipher suites, key share
  │◄── ServerHello ──│  picks suite + ALPN, sends key share
  │◄── {EE, Cert, ──│  encrypted now: chain, key proof,
  │     CV, Done} ──│  Finished
  │── {Finished} ──►│  handshake done, HTTP begins
```

The `ClientHello` names the server in cleartext ([SNI](https://en.wikipedia.org/wiki/Server_Name_Indication), so the host's front-end knows which certificate to present; [ECH](https://en.wikipedia.org/wiki/Server_Name_Indication#Encrypted_Client_Hello) encrypts even this in newer deployments) and offers [ALPN](https://en.wikipedia.org/wiki/Application-Layer_Protocol_Negotiation) protocols (usually `h2` and `http/1.1`) plus cipher suites and an ephemeral key share. The server picks, returns its own key share, and from that moment everything is encrypted: the `{...}` messages above travel under keys both sides derived independently via [ECDHE](https://en.wikipedia.org/wiki/Elliptic-curve_Diffie%E2%80%93Hellman). Ephemeral keys mean [forward secrecy](https://en.wikipedia.org/wiki/Forward_secrecy): stealing the server's private key later cannot decrypt today's traffic.

Authentication rides on the [certificate chain](https://en.wikipedia.org/wiki/Public_key_certificate). Google's leaf certificate (for `*.google.com`) is signed by an intermediate CA, which is signed by a root CA already in your OS/browser trust store. Your browser verifies each signature up the chain, checks the hostname matches, checks expiry and revocation status ([OCSP](https://en.wikipedia.org/wiki/Online_Certificate_Status_Protocol), ideally via [stapling](https://en.wikipedia.org/wiki/OCSP_stapling), where the server attaches a fresh OCSP response so you don't leak your browsing to the CA). It also consults [Certificate Transparency](https://en.wikipedia.org/wiki/Certificate_Transparency) logs for rogue issuance. The `CertificateVerify` message proves the server actually holds the leaf's private key by signing the handshake transcript.

After both `Finished` messages, TLS becomes a record layer: it chops the HTTP stream into frames, encrypts each with the negotiated symmetric cipher ([AES-GCM](https://en.wikipedia.org/wiki/Galois/Counter_Mode) or [ChaCha20-Poly1305](https://en.wikipedia.org/wiki/ChaCha20-Poly1305)), and numbers them so replays and reorderings are detected. Returning visits skip even this cost: [session resumption](https://en.wikipedia.org/wiki/Transport_Layer_Security#Resumed_TLS_handshake) with tickets or PSKs reuses a previous secret, and 0-RTT can send data immediately. Early data carries replay risk, so servers only allow idempotent requests in it.

```bash
# full handshake, cert chain, cipher, session reuse
openssl s_client -connect www.google.com:443 \
  -servername www.google.com -tls1_3
echo | openssl s_client -connect www.google.com:443 2>/dev/null \
  | openssl x509 -noout -dates -issuer -ext subjectAltName
```

> **Rule of thumb:** TLS 1.3 costs one round trip; TLS 1.2 costs two (plus a separate, malleable key exchange). If a handshake looks slow, it is almost always the network round trips, not the cryptography — the math takes microseconds.

## 5. HTTP: finally asking the question

Only now, with DNS answered, TCP opened, and TLS sealed, does the browser send the actual request:

```http
GET / HTTP/2
Host: www.google.com
User-Agent: Mozilla/5.0 (Windows x64) ...
Accept: text/html, */*;q=0.8
Accept-Language: en-US, en;q=0.9
Cookie: NID=...; 1P_JAR=...
```

The `Host` header is load-bearing: one Google IP serves thousands of sites, and this header tells the front-end which one you want. Cookies go along so the server recognizes you. Because the connection is [keep-alive](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Keep-Alive) by default, this same TCP+TLS pipe will carry the HTML, then the CSS, JS, and images that follow. No repeat handshakes.

Which HTTP version runs here was settled back in the handshake by ALPN:

| Version | Transport | Multiplexing | Head-of-line blocking | Notes |
|---|---|---|---|---|
| HTTP/1.1 | TCP | No — 1 request at a time (pipelining abandoned) | TCP-level | Simple; needs 6–8 parallel connections per page |
| HTTP/2 | TCP (single conn) | Yes — interleaved streams, [HPACK](https://en.wikipedia.org/wiki/HPACK) header compression | TCP-level (one lost packet stalls all streams) | What you most likely use for google.com |
| HTTP/3 | [QUIC](https://en.wikipedia.org/wiki/QUIC) over UDP | Yes — independent streams | None (per-stream retransmission) | 0-RTT reconnects; needs UDP/443 open |

A note on **preflight**. Typing google.com performs a plain navigation, which needs no permission dance. [CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS) preflight appears the moment *JavaScript* makes a cross-origin `fetch`: say the page's script calls an API on another domain with a `POST`, a JSON body, or a custom header. The browser first sends an `OPTIONS` request asking permission:

```http
OPTIONS /data HTTP/1.1
Host: api.example.com
Origin: https://www.google.com
Access-Control-Request-Method: POST
Access-Control-Request-Headers: content-type, x-client-version
```

The server answers with what it allows (`Access-Control-Allow-Origin`, `-Methods`, `-Headers`, `-Max-Age`), and only then does the browser send the real request. Simple `GET`/form `POST`s skip this; anything "non-[safelisted](https://developer.mozilla.org/en-US/docs/Glossary/CORS-safelisted_request_header)" triggers it. The result is cached for `Max-Age` seconds so every API call doesn't cost two round trips.

```bash
curl -X OPTIONS -v "https://api.example.com/data" \
  -H "Origin: https://app.example.com" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type"
```

A CORS failure is a browser refusal, not a server crash: the request often succeeded server-side, but the response lacked `Access-Control-Allow-Origin`, so the page was not allowed to read it. When the console shows a CORS error, inspect the `OPTIONS` response headers first. Nine times out of ten the API works fine and only the headers are missing.

### Why QUIC exists

The HTTP version table above hides the most interesting protocol design of the last decade. HTTP/2 multiplexes streams but still rides one TCP connection, so a single lost packet stalls *every* stream until it is retransmitted. That is TCP-level head-of-line blocking, and no HTTP framing trick can fix it because TCP only understands one sequence space.

[QUIC](https://en.wikipedia.org/wiki/QUIC) moves reliability up a layer: it runs over UDP and gives *each stream* its own sequence numbers and retransmission, so a loss stalls exactly one stream. Connections are identified by connection IDs instead of the 5-tuple, which buys something TCP can never offer: migration. Your phone can slide from Wi-Fi to cellular mid-download and the QUIC connection survives, because the identity of the connection no longer depends on your IP address. Transport headers are encrypted by default (which also stops middleboxes from ossifying the protocol the way they did TCP options), and the TLS 1.3 handshake is folded into the transport handshake, so repeat connections can send data in 0-RTT.

The catch is operational: QUIC needs UDP/443 open end to end, and plenty of corporate firewalls still drop it. Every deployment therefore falls back to TCP silently, which is worth remembering when HTTP/3 "works everywhere except the office."

## 6. Arrival: port 443, nginx, and the reverse proxy

Your encrypted bytes arrive at a Google front-end. One detail first, because it changes the story versus a small personal site: that `142.250.x.x` address is not one machine. Google announces the same IP ranges from hundreds of points of presence ([anycast](https://en.wikipedia.org/wiki/Anycast)), and BGP routes your packets to the nearest healthy one. Meanwhile authoritative DNS answers vary by *your* location (via [EDNS Client Subnet](https://en.wikipedia.org/wiki/EDNS_Client_Subnet)), steering different regions to different edges. Two readers on two continents type the same name and land on different continents of hardware. Everything below happens at whichever edge won you.

Conceptually, at the destination machine:

1. The kernel sees TCP port **443**, looks up the listening socket, and files the new connection: first the SYN queue (half-open, SYN-received state), then, once your final ACK arrives, the accept queue, where it waits for the proxy to call `accept()`. Both queues are bounded, which is exactly what SYN cookies protect.
2. The proxy process, nginx in our story, `accept()`s the connection and performs the TLS termination: it holds the certificate and private key, decrypts the stream, and now sees plain HTTP.
3. nginx decides what to do with the request without ever bothering the application: serve static files directly, enforce [rate limits](https://nginx.org/en/docs/http/ngx_http_limit_req_module.html), apply WAF rules, or proxy dynamic paths upstream to the app server.

The proxy step is doing more work than it gets credit for. A minimal config shows the moving parts:

```text
server {
    listen 443 ssl;
    ssl_certificate     /etc/ssl/google.crt;
    ssl_certificate_key /etc/ssl/google.key;

    location / {
        proxy_pass http://app_upstream;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
upstream app_upstream {
    least_conn;
    server 10.0.1.11:8000;
    server 10.0.1.12:8000;
    server 10.0.1.13:8000;
}
```

`proxy_pass` forwards the request over a separate, usually plaintext, local connection. TLS ended at the edge. The `X-Forwarded-*` headers are how the app learns the truth: its direct peer is nginx (`10.0.0.x`), but the real client IP and original scheme travel in headers. The `upstream` block spreads load (`round-robin` by default, `least_conn` or `ip_hash` when configured) over health-checked servers, and nginx's [buffering](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_buffering) absorbs slow clients. The app can finish its response into nginx's buffers and move on to the next request instead of dribbling bytes to a phone on a weak connection.

nginx already measures the split between its own slowness and yours. One log format makes it visible:

```text
log_format timed '$remote_addr | $request | $status | '
                 'client:${request_time}s upstream:${upstream_response_time}s';
```

`request_time` covers the whole client conversation including slow dribbling; `upstream_response_time` covers only the app. When a user complains and the two numbers disagree, the gap is the network or the client, not your code. `tail -f` that log during an incident before reaching for anything fancier.

Three status codes tell you which hop failed. `502 Bad Gateway` means nginx could not talk to the app at all: connection refused, RST, unreachable upstream. `504 Gateway Timeout` means the app accepted but answered too slowly: a stalled database, a deadlocked handler. `499` is nginx-only and means the opposite direction failed: the client disconnected first (navigated away, lost signal) while nginx was still working. Same error page shape, three different owners.

## 7. The app server: your request among fifty thousand

Your request now sits in a socket buffer on an app server, alongside tens of thousands of others. How the server reads all of them without drowning is the heart of backend engineering, and the answer on Linux is [epoll](https://man7.org/linux/man-pages/man7/epoll.7.html).

The naive design (one thread per connection, each blocked in `read()`) collapses around a few thousand connections: threads cost megabytes of stack, context switches burn CPU, and most connections are idle at any instant (waiting on the client, the database, anything). The [C10K problem](https://en.wikipedia.org/wiki/C10k_problem) forced a better shape: a handful of threads, every socket non-blocking, and one system call that sleeps until *any* socket has something to say.

<figure>
  <svg viewBox="0 0 640 250" role="img" aria-label="Epoll event loop: one thread watches thousands of sockets and dispatches only the ready ones">
    <rect x="16" y="70" width="120" height="110" rx="10" style="fill:none;stroke:var(--fainter);stroke-width:1.5;"/>
    <text x="76" y="100" text-anchor="middle" font-size="13" font-weight="600" style="fill:var(--fg);">50,000</text>
    <text x="76" y="120" text-anchor="middle" font-size="12" style="fill:var(--muted);">sockets</text>
    <text x="76" y="138" text-anchor="middle" font-size="12" style="fill:var(--muted);">mostly idle</text>
    <text x="76" y="156" text-anchor="middle" font-size="12" style="fill:var(--faint);">non-blocking</text>
    <rect x="176" y="70" width="150" height="110" rx="10" style="fill:none;stroke:var(--accent);stroke-width:2;"/>
    <text x="251" y="100" text-anchor="middle" font-size="13" font-weight="600" style="fill:var(--fg);">epoll_wait()</text>
    <text x="251" y="120" text-anchor="middle" font-size="12" style="fill:var(--muted);">sleeps here</text>
    <text x="251" y="138" text-anchor="middle" font-size="12" style="fill:var(--muted);">wakes with</text>
    <text x="251" y="156" text-anchor="middle" font-size="12" style="fill:var(--faint);">ready list only</text>
    <rect x="366" y="50" width="120" height="52" rx="8" style="fill:var(--accent-soft);stroke:var(--accent);stroke-width:1.5;"/>
    <text x="426" y="72" text-anchor="middle" font-size="12" style="fill:var(--muted);">fd 8812: READ</text>
    <text x="426" y="90" text-anchor="middle" font-size="12" style="fill:var(--faint);">your request</text>
    <rect x="366" y="112" width="120" height="52" rx="8" style="fill:none;stroke:var(--fainter);stroke-width:1.5;"/>
    <text x="426" y="134" text-anchor="middle" font-size="12" style="fill:var(--muted);">fd 204: WRITE</text>
    <text x="426" y="152" text-anchor="middle" font-size="12" style="fill:var(--faint);">flush response</text>
    <rect x="506" y="112" width="120" height="52" rx="8" style="fill:none;stroke:var(--fainter);stroke-width:1.5;"/>
    <text x="566" y="134" text-anchor="middle" font-size="12" style="fill:var(--muted);">fd 9917: READ</text>
    <text x="566" y="152" text-anchor="middle" font-size="12" style="fill:var(--faint);">another user</text>
    <line x1="138" y1="125" x2="172" y2="125" stroke-width="1.5" style="stroke:var(--faint);"/>
    <polygon points="172,125 166,122 166,128" style="fill:var(--faint);"/>
    <line x1="328" y1="110" x2="362" y2="80" stroke-width="1.5" style="stroke:var(--accent);"/>
    <polygon points="362,80 356,77 356,83" style="fill:var(--accent);"/>
    <line x1="328" y1="130" x2="362" y2="138" stroke-width="1.5" style="stroke:var(--faint);"/>
    <polygon points="362,138 356,135 356,141" style="fill:var(--faint);"/>
    <path d="M280,180 V184 H566 V170" fill="none" stroke-width="1.5" style="stroke:var(--faint);"/>
    <polygon points="566,162 560,170 572,170" style="fill:var(--faint);"/>
    <text x="320" y="212" text-anchor="middle" font-size="12" style="fill:var(--faint);">O(ready), not O(total): idle connections cost nothing per loop</text>
    <text x="320" y="232" text-anchor="middle" font-size="12" style="fill:var(--faint);">edge-triggered + EPOLLONESHOT: read until EAGAIN, then re-arm</text>
  </svg>
  <figcaption>One thread, one syscall, fifty thousand sockets. Only the ready ones wake it.</figcaption>
</figure>

Concretely: at startup the server registers every socket with `epoll_ctl`, then loops on `epoll_wait`, which blocks in the kernel until events arrive and returns *only the ready file descriptors* (3 out of 50,000, not all 50,000). That `O(ready)` scaling is the whole trick (older `select`/`poll` re-scanned everything on every call). With [edge-triggered](https://en.wikipedia.org/wiki/Epoll) mode plus `EPOLLONESHOT`, each wakeup means "read until you get `EAGAIN`, then re-arm". No event is ever delivered twice, and no thread ever blocks on a socket. This is the [Reactor pattern](https://en.wikipedia.org/wiki/Reactor_pattern) underneath Node.js's event loop, nginx's workers, [uvicorn](https://www.uvicorn.org/), and Netty alike; the flavors differ (thread pools for CPU work, one loop per core, `io_uring` as the newer sibling) but the shape is the same.

Your socket becomes ready. The server `read()`s your bytes and the request enters the software pipeline: a chain of subroutines, each with one job:

1. **Parse and route.** Split head from body, validate the request line, match `GET /` against the route table. Malformed input dies here with a `400`.
2. **Middleware chain.** Logging, metrics, authentication (your cookies → session lookup), rate limiting, tracing headers. Each is a small function wrapping the next, and most of them short-circuit on failure.
3. **Handler: the actual computation.** For `/` this means assembling the homepage: check experiments/flags, fetch personalized content (search box config, locale, doodle of the day). That is usually a cache hit in [Redis](https://redis.io/) or [Memcached](https://memcached.org/) measured in microseconds, occasionally a database query measured in milliseconds. Then it serializes the HTML. The handler never blocks the event loop on I/O: database and cache calls are themselves async (their sockets live in the same epoll set), and CPU-heavy work is pushed to a thread pool.
4. **Encode the response.** Status line, headers (`Content-Type: text/html`, `Content-Length` or chunked encoding, `Cache-Control: private`, `Set-Cookie` updates), then the body bytes into the socket's send buffer.

Slow handlers never stall other users because *reading, computing, and writing are decoupled*: your request waits on its own future while the loop keeps serving everyone else. Backpressure is the guardrail. Queues stay bounded and timeouts stay short, so one traffic spike degrades into `503`s with `Retry-After` rather than a frozen server.

The cruelest failure here is silent. When the accept queue fills, the kernel drops new connections before the application ever sees them: clients experience retransmits and timeouts while server logs show nothing. The other classic is deceptive health: p99 latency climbs while CPU looks idle, which means handlers are blocking the loop on something (DNS, disk, a lock) instead of yielding. Event-loop lag, not CPU, is the metric that catches it. Two counters tell you which one you are looking at, established count first and listen queues second:

```bash
ss -tn | wc -l
ss -lnt
```

## 8. The way back: TCP does the worrying

The response retraces the path in reverse, and TCP earns its keep on the way home. Your HTML is chopped into MSS-sized segments, each numbered; your kernel ACKs what arrives, and anything unacknowledged past the [RTO](https://en.wikipedia.org/wiki/Transmission_Control_Protocol#Retransmission_timeout) (derived from measured RTT) is retransmitted. Two sliding windows govern the pace:

- **Flow control** (receiver's window): your laptop advertises how much buffer it has left. The server never sends more than you can hold.
- **Congestion control** (sender's window): the server probes for available bandwidth, starting small ([slow start](https://en.wikipedia.org/wiki/Slow-start), doubling per RTT) and backing off on loss ([Cubic](https://en.wikipedia.org/wiki/CUBIC_TCP) is the Linux default). This is why the first bytes of a connection arrive slower than the rest, and why CDNs place edge servers near you: shorter RTT means faster ramp-up.

nginx receives the app's response first, buffers it fully, then dribbles it to you at your connection's pace. The app server is already free. NAT un-translates the destination back to `192.168.1.5:52344`, your kernel reorders and reassembles the stream, TLS decrypts each record, and HTTP hands complete body bytes to the browser as they arrive instead of waiting for the last byte. When the return path is suspect, the kernel will tell on itself:

```bash
# Retransmits, RTT, and congestion window for a live connection
ss -ti dst 142.250.72.4
mtr --report 142.250.72.4   # loss per hop on the return path
```

## 9. The browser takes over: from bytes to pixels

The browser begins parsing the HTML *while it is still downloading*. The pipeline, the [critical rendering path](https://developer.mozilla.org/en-US/docs/Web/Performance/Critical_rendering_path), has five stages, and the page appears in phases as each completes:

<figure>
  <svg viewBox="0 0 640 250" role="img" aria-label="Critical rendering path: bytes to DOM and CSSOM, render tree, layout, paint, composite">
    <g font-size="12">
      <rect x="10" y="70" width="110" height="70" rx="10" style="fill:none;stroke:var(--fainter);stroke-width:1.5;"/>
      <text x="65" y="100" text-anchor="middle" font-weight="600" style="fill:var(--fg);">HTML</text>
      <text x="65" y="118" text-anchor="middle" style="fill:var(--muted);">tokenizer</text>
      <rect x="132" y="70" width="110" height="70" rx="10" style="fill:none;stroke:var(--fainter);stroke-width:1.5;"/>
      <text x="187" y="100" text-anchor="middle" font-weight="600" style="fill:var(--fg);">DOM</text>
      <text x="187" y="118" text-anchor="middle" style="fill:var(--muted);">content tree</text>
      <rect x="254" y="70" width="110" height="70" rx="10" style="fill:none;stroke:var(--fainter);stroke-width:1.5;"/>
      <text x="309" y="100" text-anchor="middle" font-weight="600" style="fill:var(--fg);">CSSOM</text>
      <text x="309" y="118" text-anchor="middle" style="fill:var(--muted);">style tree</text>
      <rect x="376" y="70" width="96" height="70" rx="10" style="fill:none;stroke:var(--accent);stroke-width:2;"/>
      <text x="424" y="100" text-anchor="middle" font-weight="600" style="fill:var(--fg);">layout</text>
      <text x="424" y="118" text-anchor="middle" style="fill:var(--muted);">geometry</text>
      <rect x="484" y="70" width="146" height="70" rx="10" style="fill:none;stroke:var(--accent);stroke-width:2;"/>
      <text x="557" y="100" text-anchor="middle" font-weight="600" style="fill:var(--fg);">paint · composite</text>
      <text x="557" y="118" text-anchor="middle" style="fill:var(--muted);">pixels → screen</text>
    </g>
    <line x1="122" y1="105" x2="130" y2="105" stroke-width="1.5" style="stroke:var(--faint);"/>
    <polygon points="130,105 124,102 124,108" style="fill:var(--faint);"/>
    <line x1="244" y1="105" x2="252" y2="105" stroke-width="1.5" style="stroke:var(--faint);"/>
    <polygon points="252,105 246,102 246,108" style="fill:var(--faint);"/>
    <text x="309" y="56" text-anchor="middle" font-size="11" style="fill:var(--faint);">CSS blocks render</text>
    <line x1="366" y1="105" x2="374" y2="105" stroke-width="1.5" style="stroke:var(--faint);"/>
    <polygon points="374,105 368,102 368,108" style="fill:var(--faint);"/>
    <line x1="474" y1="105" x2="482" y2="105" stroke-width="1.5" style="stroke:var(--faint);"/>
    <polygon points="482,105 476,102 476,108" style="fill:var(--faint);"/>
    <text x="320" y="172" text-anchor="middle" font-size="12" style="fill:var(--faint);">DOM + CSSOM form the render tree (visible nodes only), then geometry, then layers</text>
    <text x="320" y="194" text-anchor="middle" font-size="12" style="fill:var(--faint);">plain scripts block the tokenizer, but the preload scanner fetches ahead anyway</text>
    <text x="320" y="222" text-anchor="middle" font-size="12" style="fill:var(--faint);">the compositor animates transforms on the GPU without re-layout</text>
  </svg>
  <figcaption>Bytes become boxes, boxes become layers, layers become the page.</figcaption>
</figure>

1. **Parse HTML → DOM.** The streaming tokenizer turns `<div>` into tokens, the tree builder nests them. A [preload scanner](https://developer.mozilla.org/en-US/docs/Glossary/Preload_scanner) races ahead fetching CSS, JS, and images before the main parser reaches them.
2. **Parse CSS → CSSOM.** Stylesheets are render-blocking by design: the browser will not paint until CSS is ready, because painting then repainting would flash unstyled content.
3. **JavaScript runs.** Classic `<script>` blocks the parser (the script might `document.write`); `defer` scripts wait for parsing to finish in order, `async` scripts run whenever they land. The [V8](https://v8.dev/) engine parses, compiles to bytecode (Ignition) and optimized machine code (TurboFan), and executes on the main thread's [event loop](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Event_loop). Long tasks here freeze the page, which is why frameworks split work into chunks.
4. **Render tree + layout.** DOM meets CSSOM; invisible nodes (`display: none`, head) are dropped. Layout (reflow) computes every visible box's exact position and size. It is the most expensive step, and the reason layout thrashing (alternating reads and writes of geometry in JS) is a classic performance bug.
5. **Paint + composite.** Boxes are rasterized into bitmap layers (text, images, backgrounds), then the compositor thread hands layers to the GPU, which draws them to the screen at vsync cadence, a new frame every ~16.7ms at 60Hz. Transforms and opacity animate cheaply here precisely because they skip layout and paint entirely.

Meanwhile every subresource repeats a miniature version of the whole journey, but cheaper: DNS and TLS are cached and reused, connections are shared (HTTP/2 multiplexing), and validators avoid re-downloading. A repeat visit with `Cache-Control: max-age=31536000` on static assets and `ETag` revalidation on HTML loads with barely any network at all: `If-None-Match` goes out, `304 Not Modified` comes back, the page renders from disk.

Open devtools on any page and record the Performance tab while reloading: the waterfall shows parsing, scripting, layout, and paint as separate blocks, and the Rendering drawer can flash repainted regions live. For the network half of the story, `chrome://net-export` captures the socket-level log, DNS timings, QUIC fallback decisions and all. A long blank white screen means render-blocking CSS or JS; jank after load means long tasks or layout thrash, which the Long Tasks section of the trace names directly.

## The whole trip, on one receipt

| # | Stage | Protocol | Port | One-line job |
|---|---|---|---|---|
| 0 | URL parse, HSTS, caches | — | — | Decide https, skip network if possible |
| 1 | DNS lookup | DNS/UDP (DoH/DoT optional) | 53 | Name → IP, cached by TTL |
| 2 | ARP + routing + NAT | ARP/IP, conntrack | — | Frame it, route it, borrow a public address |
| 3 | TCP handshake | TCP | 443 | Reliable ordered pipe (SYN, SYN-ACK, ACK) |
| 4 | TLS handshake | TLS 1.3 | 443 | Authenticate + forward-secret keys (1 RTT) |
| 5 | HTTP request (+ preflight for JS APIs) | HTTP/2 (ALPN) | 443 | Ask the question; OPTIONS first if CORS demands |
| 6 | Reverse proxy | nginx `proxy_pass` | 443 → 8000s | Terminate TLS, limit, balance, buffer |
| 7 | App server | epoll + handlers | 8000 | Read among thousands, route, compute, respond |
| 8 | Return path | TCP (ACKs, Cubic) | 443 | Retransmit, pace, reassemble |
| 9 | Render | HTML/CSS/JS engines | — | DOM + CSSOM → layout → paint → composite |

## A few practical rules of thumb

1. Slow page loads are usually DNS + round trips, not bandwidth. Measure time-to-first-byte split by DNS, TCP, TLS, and server processing before optimizing anything.
2. Reuse connections aggressively: one warm HTTP/2 connection beats six cold HTTP/1.1 ones, and every avoided handshake is a full round trip saved.
3. Terminate TLS at the edge (nginx, CDN, load balancer), not in every app process. One place holds the certificates and the app CPU stays on real work.
4. Never block an event loop. If one request's handler stalls, epoll keeps delivering everyone else's, but only if handlers yield on I/O.
5. Cache at every layer on purpose: DNS TTLs, CDN edge rules, `Cache-Control` + `ETag` validators, and nginx buffering each convert repeat work into zero work.

---

That is the full receipt: a dozen systems, each answering one question, most of them in milliseconds. The next time a page hangs, walk the table top to bottom and match the symptom to a row. DNS errors name themselves, `SYN-SENT` points at the network, TLS errors quote the certificate, 502/504/499 name the failed hop, and the Timing tab covers the rest.

For further reading, [High Performance Browser Networking](https://hpbn.co/) by Ilya Grigorik covers every stage above at full textbook depth, [MDN's CORS guide](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS) is the definitive preflight reference, and the [nginx proxy module docs](https://nginx.org/en/docs/http/ngx_http_proxy_module.html) document every knob in section 6.

*Disclosure: I used AI assistance to generate the SVG illustrations in this post and to collect the external reference links for technical terms. The explanations, examples, commands, and any mistakes are mine.*
