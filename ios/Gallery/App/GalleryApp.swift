import SwiftUI
import WebKit
import Photos
import UIKit
import Speech
import AVFoundation
import MediaPlayer
import Vision

// Gallery: shows the gallery page (aura-tricks/gallery/) full screen and gives it
// FULL access to the iPhone photo library. The page asks for photos with
// window.webkit.messageHandlers.fvgal.postMessage({...}); the app answers by calling
// __galNativeInit(count, status), __galThumbs(items, failedIds) and __galFull(index, dataURL).
// Voice: {t:'listen',on,lang} → __galSpeech(text, isFinal), __galVoice(state).
// Read text: {t:'ocr',on,cam:'back'|'front'} → __galOCR([{t,c,h,w,y}]), __galRead(state).
// Volume buttons: {t:'volume',on:true} → __galVol('up'|'down'). Haptic: {t:'buzz'}.

@main
struct GalleryApp: App {
    var body: some Scene {
        WindowGroup {
            GalleryWeb()
                .ignoresSafeArea()
                .background(Color.black)
        }
    }
}

struct GalleryWeb: UIViewRepresentable {
    func makeCoordinator() -> PhotoBridge { PhotoBridge() }

    func makeUIView(context: Context) -> WKWebView {
        let bridge = context.coordinator
        let ucc = WKUserContentController()
        ucc.add(bridge, name: "fvgal")
        ucc.addUserScript(WKUserScript(source: "window.FVNative=1;", injectionTime: .atDocumentStart, forMainFrameOnly: true))

        let cfg = WKWebViewConfiguration()
        cfg.userContentController = ucc
        cfg.allowsInlineMediaPlayback = true
        cfg.websiteDataStore = .default()

        let web = WKWebView(frame: .zero, configuration: cfg)
        web.isOpaque = false
        web.backgroundColor = .black
        web.scrollView.backgroundColor = .black
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.scrollView.isScrollEnabled = false
        web.scrollView.bounces = false
        web.scrollView.pinchGestureRecognizer?.isEnabled = false
        web.allowsLinkPreview = false
        web.navigationDelegate = bridge
        bridge.web = web
        bridge.loadPage()
        return web
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

final class PhotoBridge: NSObject, WKScriptMessageHandler, WKNavigationDelegate, PHPhotoLibraryChangeObserver {
    static let pageURL = URL(string: "https://frankiemagic13.github.io/aura-tricks/gallery/?app=1")!

    weak var web: WKWebView?
    private var assets: PHFetchResult<PHAsset>?
    private var status = "wait"
    private let manager = PHImageManager.default()
    private let work = DispatchQueue(label: "gallery.thumbs", qos: .userInitiated, attributes: .concurrent)
    private var observing = false
    private let listener = Listener()
    private let volume = VolumeWatch()
    private let reader = TextReader()

    override init() {
        super.init()
        listener.onText = { [weak self] text, fin in
            self?.js("window.__galSpeech&&__galSpeech(\(PhotoBridge.jsString(text)),\(fin))")
        }
        listener.onState = { [weak self] st in self?.js("window.__galVoice&&__galVoice('\(st)')") }
        volume.onPress = { [weak self] b in self?.js("window.__galVol&&__galVol('\(b)')") }
        reader.onText = { [weak self] lines in
            guard let d = try? JSONSerialization.data(withJSONObject: lines), let j = String(data: d, encoding: .utf8) else { return }
            self?.js("window.__galOCR&&__galOCR(\(j))")
        }
        reader.onState = { [weak self] st in self?.js("window.__galRead&&__galRead('\(st)')") }
    }

    func loadPage() {
        var req = URLRequest(url: Self.pageURL)
        req.cachePolicy = .reloadRevalidatingCacheData
        web?.load(req)
    }

    deinit {
        if observing { PHPhotoLibrary.shared().unregisterChangeObserver(self) }
    }

    // MARK: messages from the page

    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["t"] as? String else { return }
        switch type {
        case "init":
            start()
        case "thumbs":
            let ids = (body["ids"] as? [NSNumber])?.map { $0.intValue } ?? []
            let size = (body["s"] as? NSNumber)?.intValue ?? 200
            thumbs(ids, size: size)
        case "full":
            if let k = (body["k"] as? NSNumber)?.intValue { full(k) }
        case "listen":
            if (body["on"] as? Bool) == true {
                listener.start(lang: body["lang"] as? String ?? "en-US")
            } else {
                listener.stop()
            }
        case "ocr":
            if (body["on"] as? Bool) == true {
                reader.start(front: (body["cam"] as? String) == "front")
            } else {
                reader.stop()
            }
        case "volume":
            if let host = web { volume.start(in: host) }
        case "buzz":
            DispatchQueue.main.async { UIImpactFeedbackGenerator(style: .medium).impactOccurred() }
        case "settings":
            if let url = URL(string: UIApplication.openSettingsURLString) {
                DispatchQueue.main.async { UIApplication.shared.open(url) }
            }
        default:
            break
        }
    }

    // MARK: photo library

    private func start() {
        PHPhotoLibrary.requestAuthorization(for: .readWrite) { st in
            DispatchQueue.main.async {
                switch st {
                case .authorized: self.status = "full"
                case .limited: self.status = "limited"
                default: self.status = "denied"
                }
                if st == .authorized || st == .limited {
                    self.fetch()
                    if !self.observing {
                        PHPhotoLibrary.shared().register(self)
                        self.observing = true
                    }
                } else {
                    self.assets = nil
                }
                self.sendInit()
            }
        }
    }

    private func fetch() {
        let opt = PHFetchOptions()
        opt.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: true)]
        opt.includeHiddenAssets = false
        assets = PHAsset.fetchAssets(with: opt)   // photos and videos, oldest first (newest at the bottom)
    }

    private func sendInit() {
        js("window.__galNativeInit&&__galNativeInit(\(assets?.count ?? 0),'\(status)')")
    }

    func photoLibraryDidChange(_ changeInstance: PHChange) {
        guard let a = assets, let details = changeInstance.changeDetails(for: a) else { return }
        DispatchQueue.main.async {
            self.assets = details.fetchResultAfterChanges
            self.sendInit()   // a new photo shows at the bottom
        }
    }

    private func thumbs(_ ids: [Int], size: Int) {
        guard let a = assets else {
            js("window.__galThumbs&&__galThumbs([],\(jsonArray(ids)))")
            return
        }
        let count = a.count
        work.async { [weak self] in
            guard let self = self else { return }
            let opt = PHImageRequestOptions()
            opt.isSynchronous = true
            opt.deliveryMode = .highQualityFormat
            opt.resizeMode = .fast
            opt.isNetworkAccessAllowed = true
            let px = CGFloat(max(64, min(size, 400)))
            var items: [String] = []
            var failed: [Int] = []
            for k in ids {
                guard k >= 0 && k < count else { failed.append(k); continue }
                let asset = a.object(at: k)
                var out: UIImage?
                self.manager.requestImage(for: asset, targetSize: CGSize(width: px, height: px),
                                          contentMode: .aspectFill, options: opt) { img, _ in out = img }
                guard let img = out, let data = img.jpegData(compressionQuality: 0.72) else { failed.append(k); continue }
                let v = asset.mediaType == .video ? Int(asset.duration.rounded()) : -1
                items.append("{\"k\":\(k),\"v\":\(v),\"d\":\"data:image/jpeg;base64,\(data.base64EncodedString())\"}")
            }
            let script = "window.__galThumbs&&__galThumbs([\(items.joined(separator: ","))],\(self.jsonArray(failed)))"
            DispatchQueue.main.async { self.js(script) }
        }
    }

    private func full(_ k: Int) {
        guard let a = assets, k >= 0, k < a.count else { return }
        let asset = a.object(at: k)
        work.async { [weak self] in
            guard let self = self else { return }
            let opt = PHImageRequestOptions()
            opt.isSynchronous = true
            opt.deliveryMode = .highQualityFormat
            opt.resizeMode = .exact
            opt.isNetworkAccessAllowed = true
            var out: UIImage?
            self.manager.requestImage(for: asset, targetSize: CGSize(width: 1600, height: 1600),
                                      contentMode: .aspectFit, options: opt) { img, _ in out = img }
            guard let img = out, let data = img.jpegData(compressionQuality: 0.85) else { return }
            let script = "window.__galFull&&__galFull(\(k),'data:image/jpeg;base64,\(data.base64EncodedString())')"
            DispatchQueue.main.async { self.js(script) }
        }
    }

    // MARK: helpers

    static func jsString(_ s: String) -> String {
        guard let d = try? JSONSerialization.data(withJSONObject: [s]), let j = String(data: d, encoding: .utf8) else { return "\"\"" }
        return String(j.dropFirst().dropLast())
    }

    private func jsonArray(_ a: [Int]) -> String { "[" + a.map(String.init).joined(separator: ",") + "]" }

    private func js(_ s: String) {
        web?.evaluateJavaScript(s, completionHandler: nil)
    }

    // No internet when the app opens: try again after 3 seconds.
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in self?.loadPage() }
    }

    // Links that leave the gallery page (for example the kill switch) open in the web view as usual.
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        decisionHandler(.allow)
    }
}

// MARK: - audio session (shared by voice and volume buttons)

enum Audio {
    static func activate() {
        let s = AVAudioSession.sharedInstance()
        try? s.setCategory(.playAndRecord, mode: .default, options: [.mixWithOthers, .defaultToSpeaker, .allowBluetoothA2DP])
        try? s.setActive(true)
    }
}

// MARK: - voice (Speech framework)

final class Listener {
    var onText: ((String, Bool) -> Void)?
    var onState: ((String) -> Void)?
    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var recognizer: SFSpeechRecognizer?
    private var on = false
    private var gen = 0

    func start(lang: String) {
        on = true
        SFSpeechRecognizer.requestAuthorization { st in
            DispatchQueue.main.async {
                guard st == .authorized else { self.on = false; self.onState?("denied"); return }
                AVAudioApplication.requestRecordPermission { ok in
                    DispatchQueue.main.async {
                        guard ok else { self.on = false; self.onState?("denied"); return }
                        self.recognizer = SFSpeechRecognizer(locale: Locale(identifier: lang)) ?? SFSpeechRecognizer()
                        self.begin()
                    }
                }
            }
        }
    }

    func stop() {
        on = false
        gen += 1
        stopAudio()
    }

    private func begin() {
        guard on else { return }
        gen += 1
        let myGen = gen
        stopAudio()
        guard let rec = recognizer, rec.isAvailable else {
            onState?("error")
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
                if let self = self, self.on, self.gen == myGen { self.begin() }
            }
            return
        }
        Audio.activate()
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        if rec.supportsOnDeviceRecognition { req.requiresOnDeviceRecognition = true }
        request = req
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            self?.request?.append(buffer)
        }
        engine.prepare()
        do { try engine.start() } catch { onState?("error"); return }
        task = rec.recognitionTask(with: req) { [weak self] result, error in
            guard let self = self else { return }
            let fin = result?.isFinal ?? false
            if let result = result {
                let text = result.bestTranscription.formattedString
                DispatchQueue.main.async { if self.gen == myGen { self.onText?(text, fin) } }
            }
            if error != nil || fin {
                // a session ends after a pause or about 1 minute: start a new one
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                    if self.on && self.gen == myGen { self.begin() }
                }
            }
        }
        onState?("listening")
    }

    private func stopAudio() {
        task?.cancel()
        task = nil
        request?.endAudio()
        request = nil
        if engine.isRunning { engine.stop() }
        engine.inputNode.removeTap(onBus: 0)
    }
}

// MARK: - volume buttons as triggers (the volume goes back after each press, no volume HUD)

final class VolumeWatch: NSObject {
    var onPress: ((String) -> Void)?
    private let volumeView = MPVolumeView(frame: CGRect(x: -100, y: -100, width: 1, height: 1))
    private var observation: NSKeyValueObservation?
    private var base: Float = 0.5
    private var ignoreUntil = Date.distantPast
    private var started = false

    func start(in host: UIView) {
        if volumeView.superview == nil {
            volumeView.alpha = 0.01
            volumeView.isUserInteractionEnabled = false
            host.addSubview(volumeView)
        }
        guard !started else { return }
        started = true
        Audio.activate()
        let s = AVAudioSession.sharedInstance()
        base = s.outputVolume
        if base > 0.94 { setVolume(0.9) } else if base < 0.06 { setVolume(0.1) }
        observation = s.observe(\.outputVolume, options: [.new]) { [weak self] _, change in
            guard let self = self, let v = change.newValue else { return }
            DispatchQueue.main.async { self.changed(v) }
        }
        NotificationCenter.default.addObserver(self, selector: #selector(active),
                                               name: UIApplication.didBecomeActiveNotification, object: nil)
    }

    private func changed(_ v: Float) {
        if Date() < ignoreUntil || abs(v - base) < 0.001 { return }
        onPress?(v > base ? "up" : "down")
        setVolume(base)
    }

    private func setVolume(_ v: Float) {
        base = v
        ignoreUntil = Date().addingTimeInterval(0.35)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
            if let slider = self.volumeView.subviews.compactMap({ $0 as? UISlider }).first {
                slider.setValue(v, animated: false)
                slider.sendActions(for: .valueChanged)
            }
        }
    }

    @objc private func active() {
        Audio.activate()
        base = AVAudioSession.sharedInstance().outputVolume
    }
}

// MARK: - read text with the camera (Apple Vision), no preview on screen

final class TextReader: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    var onText: (([[String: Any]]) -> Void)?
    var onState: ((String) -> Void)?
    private let session = AVCaptureSession()
    private let queue = DispatchQueue(label: "gallery.ocr")
    private var input: AVCaptureDeviceInput?
    private var outputAdded = false
    private var front = false
    private var on = false
    private var busy = false
    private var last = Date.distantPast
    private var flip = false

    func start(front: Bool) {
        on = true
        AVCaptureDevice.requestAccess(for: .video) { ok in
            DispatchQueue.main.async {
                guard ok else { self.on = false; self.onState?("denied"); return }
                self.queue.async {
                    guard self.configure(front: front) else {
                        DispatchQueue.main.async { self.onState?("error") }
                        return
                    }
                    if self.on && !self.session.isRunning { self.session.startRunning() }
                    DispatchQueue.main.async { self.onState?("reading") }
                }
            }
        }
    }

    func stop() {
        on = false
        queue.async { if self.session.isRunning { self.session.stopRunning() } }
    }

    // runs on queue
    private func configure(front: Bool) -> Bool {
        if input != nil && self.front == front { return true }
        session.automaticallyConfiguresApplicationAudioSession = false   // keep the volume buttons working
        session.beginConfiguration()
        defer { session.commitConfiguration() }
        session.sessionPreset = .hd1280x720
        if let old = input { session.removeInput(old); input = nil }
        guard let dev = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: front ? .front : .back),
              let inp = try? AVCaptureDeviceInput(device: dev), session.canAddInput(inp) else { return false }
        session.addInput(inp)
        input = inp
        self.front = front
        if !outputAdded {
            let out = AVCaptureVideoDataOutput()
            out.alwaysDiscardsLateVideoFrames = true
            out.setSampleBufferDelegate(self, queue: queue)
            if session.canAddOutput(out) { session.addOutput(out); outputAdded = true }
        }
        if (try? dev.lockForConfiguration()) != nil {
            if dev.isFocusModeSupported(.continuousAutoFocus) { dev.focusMode = .continuousAutoFocus }
            if dev.isAutoFocusRangeRestrictionSupported { dev.autoFocusRangeRestriction = .near }
            dev.unlockForConfiguration()
        }
        return true
    }

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard on, !busy, Date().timeIntervalSince(last) > 0.35,
              let pixels = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        busy = true
        last = Date()
        // phone held upright. Front camera: also try the mirrored image on every second frame.
        flip.toggle()
        let orientation: CGImagePropertyOrientation = front ? (flip ? .left : .leftMirrored) : .right
        let request = VNRecognizeTextRequest { [weak self] req, _ in
            guard let self = self else { return }
            let found = (req.results as? [VNRecognizedTextObservation]) ?? []
            let lines: [[String: Any]] = found.compactMap { o in
                guard let best = o.topCandidates(1).first else { return nil }
                let b = o.boundingBox
                return ["t": best.string, "c": Double(best.confidence),
                        "h": Double(b.height), "w": Double(b.width), "y": Double(b.midY)]
            }
            if !lines.isEmpty { DispatchQueue.main.async { self.onText?(lines) } }
        }
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        let handler = VNImageRequestHandler(cvPixelBuffer: pixels, orientation: orientation, options: [:])
        try? handler.perform([request])
        busy = false
    }
}
