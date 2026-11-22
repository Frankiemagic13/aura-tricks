import SwiftUI
import WebKit
import Photos
import UIKit

// Gallery: shows the gallery page (aura-tricks/gallery/) full screen and gives it
// FULL access to the iPhone photo library. The page asks for photos with
// window.webkit.messageHandlers.fvgal.postMessage({...}); the app answers by calling
// __galNativeInit(count, status), __galThumbs(items, failedIds) and __galFull(index, dataURL).

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
