#import <AVFoundation/AVFoundation.h>

#include "camera.h"

#include <cstdio>
#include <cstring>
#include <mutex>

namespace {
struct Shared {
    std::mutex mutex;
    std::vector<uint8_t> pixels;
    int width = 0;
    int height = 0;
    bool fresh = false;
};
} // namespace

@interface FrameSink : NSObject <AVCaptureVideoDataOutputSampleBufferDelegate> {
@public
    std::shared_ptr<Shared> shared;
}
@end

@implementation FrameSink
- (void)captureOutput:(AVCaptureOutput*)output
    didOutputSampleBuffer:(CMSampleBufferRef)sampleBuffer
           fromConnection:(AVCaptureConnection*)connection {
    CVImageBufferRef image = CMSampleBufferGetImageBuffer(sampleBuffer);
    if (!image) return;
    CVPixelBufferLockBaseAddress(image, kCVPixelBufferLock_ReadOnly);
    const uint8_t* base = static_cast<const uint8_t*>(CVPixelBufferGetBaseAddress(image));
    size_t w = CVPixelBufferGetWidth(image);
    size_t h = CVPixelBufferGetHeight(image);
    size_t stride = CVPixelBufferGetBytesPerRow(image);
    if (base) {
        std::lock_guard<std::mutex> lock(shared->mutex);
        if (!shared->width) std::fprintf(stderr, "camera: receiving %zux%zu frames\n", w, h);
        shared->pixels.resize(w * h * 4);
        // Rows can be padded, so copy one at a time.
        for (size_t y = 0; y < h; y++)
            std::memcpy(shared->pixels.data() + y * w * 4, base + y * stride, w * 4);
        shared->width = static_cast<int>(w);
        shared->height = static_cast<int>(h);
        shared->fresh = true;
    }
    CVPixelBufferUnlockBaseAddress(image, kCVPixelBufferLock_ReadOnly);
}
@end

struct Camera::Impl {
    std::shared_ptr<Shared> shared = std::make_shared<Shared>();
    AVCaptureSession* session = nil;
    FrameSink* sink = nil;
    dispatch_queue_t queue = dispatch_queue_create("creative-plus-plus.camera", DISPATCH_QUEUE_SERIAL);

    void begin() {
        AVCaptureDevice* device = [AVCaptureDevice defaultDeviceWithMediaType:AVMediaTypeVideo];
        if (!device) {
            std::fprintf(stderr, "camera: no video device found\n");
            return;
        }
        NSError* error = nil;
        AVCaptureDeviceInput* input = [AVCaptureDeviceInput deviceInputWithDevice:device error:&error];
        if (!input) {
            std::fprintf(stderr, "camera: %s\n", error.localizedDescription.UTF8String);
            return;
        }

        session = [[AVCaptureSession alloc] init];
        if ([session canSetSessionPreset:AVCaptureSessionPreset1280x720])
            session.sessionPreset = AVCaptureSessionPreset1280x720;

        AVCaptureVideoDataOutput* output = [[AVCaptureVideoDataOutput alloc] init];
        output.videoSettings = @{(id)kCVPixelBufferPixelFormatTypeKey : @(kCVPixelFormatType_32BGRA)};
        output.alwaysDiscardsLateVideoFrames = YES;
        sink = [[FrameSink alloc] init];
        sink->shared = shared;
        [output setSampleBufferDelegate:sink queue:queue];

        if (![session canAddInput:input] || ![session canAddOutput:output]) {
            std::fprintf(stderr, "camera: could not configure capture session\n");
            session = nil;
            return;
        }
        [session addInput:input];
        [session addOutput:output];
        [session startRunning];
    }
};

Camera::Camera() : impl(std::make_unique<Impl>()) {}

Camera::~Camera() {
    // Drain the queue so a pending begin() cannot outlive impl.
    Impl* p = impl.get();
    dispatch_sync(p->queue, ^{
        [p->session stopRunning];
    });
}

void Camera::start() {
    Impl* p = impl.get();
    switch ([AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeVideo]) {
    case AVAuthorizationStatusAuthorized:
        dispatch_async(p->queue, ^{
            p->begin();
        });
        break;
    case AVAuthorizationStatusNotDetermined: {
        std::fprintf(stderr, "camera: waiting for permission\n");
        // Capture the queue and shared state rather than `p`, in case the
        // answer arrives after the Camera is gone.
        dispatch_queue_t queue = p->queue;
        std::weak_ptr<Shared> alive = p->shared;
        [AVCaptureDevice requestAccessForMediaType:AVMediaTypeVideo
                                 completionHandler:^(BOOL granted) {
                                     if (!granted) {
                                         std::fprintf(stderr, "camera: access denied\n");
                                         return;
                                     }
                                     dispatch_async(queue, ^{
                                         if (!alive.expired()) p->begin();
                                     });
                                 }];
        break;
    }
    default:
        std::fprintf(stderr, "camera: access denied; allow it for your terminal in "
                             "System Settings > Privacy & Security > Camera\n");
        break;
    }
}

bool Camera::poll(std::vector<uint8_t>& bgra, int& width, int& height) {
    std::lock_guard<std::mutex> lock(impl->shared->mutex);
    if (!impl->shared->fresh) return false;
    std::swap(bgra, impl->shared->pixels);
    width = impl->shared->width;
    height = impl->shared->height;
    impl->shared->fresh = false;
    return true;
}
