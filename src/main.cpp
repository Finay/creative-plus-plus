// Creative++: a fullscreen fragment-shader sketchbook with hot reload.
// Edit the shader while the program runs and it recompiles on save.
// Usage: sketch [shader.frag] [--frames N]

#define GLFW_INCLUDE_GLCOREARB
#include <GLFW/glfw3.h>

#include "ball.h"
#include "camera.h"
#include "history.h"

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

namespace fs = std::filesystem;

// One triangle that covers the whole screen; no vertex buffer needed.
static const char* kVertSrc = R"(#version 410 core
void main() {
    vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
    gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
)";

static std::string readFile(const char* path) {
    std::ifstream in(path);
    std::stringstream ss;
    ss << in.rdbuf();
    return ss.str();
}

static GLuint compile(GLenum type, const char* src) {
    GLuint s = glCreateShader(type);
    glShaderSource(s, 1, &src, nullptr);
    glCompileShader(s);
    GLint ok = 0;
    glGetShaderiv(s, GL_COMPILE_STATUS, &ok);
    if (!ok) {
        char log[4096];
        glGetShaderInfoLog(s, sizeof log, nullptr, log);
        std::fprintf(stderr, "shader compile error:\n%s\n", log);
        glDeleteShader(s);
        return 0;
    }
    return s;
}

// Returns 0 on failure so the caller can keep the previous program running.
static GLuint buildProgram(const char* fragPath) {
    std::string fragSrc = readFile(fragPath);
    if (fragSrc.empty()) {
        std::fprintf(stderr, "could not read %s (run from the project root)\n", fragPath);
        return 0;
    }
    GLuint vs = compile(GL_VERTEX_SHADER, kVertSrc);
    GLuint fsh = compile(GL_FRAGMENT_SHADER, fragSrc.c_str());
    if (!vs || !fsh) {
        glDeleteShader(vs);
        glDeleteShader(fsh);
        return 0;
    }
    GLuint prog = glCreateProgram();
    glAttachShader(prog, vs);
    glAttachShader(prog, fsh);
    glLinkProgram(prog);
    glDeleteShader(vs);
    glDeleteShader(fsh);
    GLint ok = 0;
    glGetProgramiv(prog, GL_LINK_STATUS, &ok);
    if (!ok) {
        char log[4096];
        glGetProgramInfoLog(prog, sizeof log, nullptr, log);
        std::fprintf(stderr, "program link error:\n%s\n", log);
        glDeleteProgram(prog);
        return 0;
    }
    return prog;
}

static fs::file_time_type mtime(const char* path) {
    std::error_code ec;
    auto t = fs::last_write_time(path, ec);
    return ec ? fs::file_time_type::min() : t;
}

// Sends the ball and its shards to the shader's ball uniforms.
static void uploadBall(GLuint program, GLint ballLoc, const Ball& ball) {
    glUniform3f(ballLoc, ball.x, ball.y, ball.alive ? ball.radius : 0.0f);
    glUniform3f(glGetUniformLocation(program, "uBallSquish"), ball.squishX, ball.squishY, ball.squish);

    float shards[Ball::kMaxShards * 3] = {};
    int shardCount = std::min(int(ball.shards.size()), int(Ball::kMaxShards));
    for (int i = 0; i < shardCount; i++) {
        shards[i * 3 + 0] = ball.shards[i].x;
        shards[i * 3 + 1] = ball.shards[i].y;
        shards[i * 3 + 2] = ball.shards[i].life;
    }
    glUniform3fv(glGetUniformLocation(program, "uShards"), Ball::kMaxShards, shards);
    glUniform1i(glGetUniformLocation(program, "uShardCount"), shardCount);
    glUniform1f(glGetUniformLocation(program, "uShardSize"), ball.radius * 0.33f);
    glUniform1f(glGetUniformLocation(program, "uSolid"), Ball::kSolid);
}

int main(int argc, char** argv) {
    const char* fragPath = "shaders/ball.frag";
    long maxFrames = -1; // --frames N renders N frames and exits
    for (int i = 1; i < argc; i++) {
        if (std::string(argv[i]) == "--frames" && i + 1 < argc) maxFrames = std::atol(argv[++i]);
        else fragPath = argv[i];
    }

    glfwSetErrorCallback([](int code, const char* msg) {
        std::fprintf(stderr, "glfw error %d: %s\n", code, msg);
    });
    if (!glfwInit()) return 1;

    // macOS tops out at OpenGL 4.1 core.
    glfwWindowHint(GLFW_CONTEXT_VERSION_MAJOR, 4);
    glfwWindowHint(GLFW_CONTEXT_VERSION_MINOR, 1);
    glfwWindowHint(GLFW_OPENGL_PROFILE, GLFW_OPENGL_CORE_PROFILE);
    glfwWindowHint(GLFW_OPENGL_FORWARD_COMPAT, GL_TRUE);

    GLFWwindow* window = glfwCreateWindow(960, 720, "Creative++", nullptr, nullptr);
    if (!window) {
        glfwTerminate();
        return 1;
    }
    glfwMakeContextCurrent(window);
    glfwSwapInterval(1);

    glfwSetKeyCallback(window, [](GLFWwindow* w, int key, int, int action, int) {
        if (key == GLFW_KEY_ESCAPE && action == GLFW_PRESS) glfwSetWindowShouldClose(w, GLFW_TRUE);
    });

    // Core profile requires a bound VAO even when no attributes are used.
    GLuint vao = 0;
    glGenVertexArrays(1, &vao);
    glBindVertexArray(vao);

    GLuint program = buildProgram(fragPath);
    auto lastWrite = mtime(fragPath);
    if (!program) {
        glfwTerminate();
        return 1;
    }

    // Camera frames land in this texture. The camera is only switched on once
    // a shader declares and uses `uCamera` or `uHistory`.
    GLuint cameraTex = 0;
    glGenTextures(1, &cameraTex);
    glBindTexture(GL_TEXTURE_2D, cameraTex);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR_MIPMAP_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    const unsigned char black[4] = {0, 0, 0, 255};
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, 1, 1, 0, GL_BGRA, GL_UNSIGNED_BYTE, black);
    glGenerateMipmap(GL_TEXTURE_2D);

    Camera camera;
    bool cameraStarted = false;
    std::vector<uint8_t> cameraPixels;
    int cameraW = 1, cameraH = 1;

    // Past camera frames on texture unit 1, kept only while a shader uses `uHistory`.
    FrameHistory history;

    // Simulated only while a shader declares and uses `uBall`. Space drops a new one.
    Ball ball;
    double lastTime = glfwGetTime();

    // Frame rate for `uFps`, counted over half-second windows so it is readable.
    double fpsSince = lastTime;
    int fpsFrames = 0;
    float fps = 0.0f;

    for (long frame = 0; !glfwWindowShouldClose(window); ++frame) {
        if (maxFrames >= 0 && frame >= maxFrames) break;

        if (auto t = mtime(fragPath); t != lastWrite) {
            lastWrite = t;
            if (GLuint next = buildProgram(fragPath)) {
                glDeleteProgram(program);
                program = next;
                std::fprintf(stderr, "reloaded %s\n", fragPath);
            }
        }

        // Features switch on by the uniforms the open shader actually uses.
        GLint cameraLoc = glGetUniformLocation(program, "uCamera");
        GLint historyLoc = glGetUniformLocation(program, "uHistory");
        GLint ballLoc = glGetUniformLocation(program, "uBall");

        if ((cameraLoc >= 0 || historyLoc >= 0) && !cameraStarted) {
            camera.start();
            cameraStarted = true;
        }
        if (cameraStarted && camera.poll(cameraPixels, cameraW, cameraH)) {
            glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, cameraW, cameraH, 0, GL_BGRA, GL_UNSIGNED_BYTE,
                         cameraPixels.data());
            glGenerateMipmap(GL_TEXTURE_2D);
            if (ballLoc >= 0) ball.setFrame(cameraPixels, cameraW, cameraH);
            if (historyLoc >= 0) history.push(cameraPixels, cameraW, cameraH, 1);
        }
        if (historyLoc >= 0) history.bind(1);

        int w, h;
        glfwGetFramebufferSize(window, &w, &h);
        int ww, wh;
        glfwGetWindowSize(window, &ww, &wh);
        double mx, my;
        glfwGetCursorPos(window, &mx, &my);
        // Cursor is in window coordinates with a top-left origin; convert to
        // framebuffer pixels with a bottom-left origin to match gl_FragCoord.
        float sx = ww > 0 ? float(w) / float(ww) : 1.0f;
        float sy = wh > 0 ? float(h) / float(wh) : 1.0f;

        double now = glfwGetTime();
        float dt = float(now - lastTime);
        lastTime = now;
        fpsFrames++;
        if (now - fpsSince >= 0.5) {
            fps = float(fpsFrames / (now - fpsSince));
            fpsSince = now;
            fpsFrames = 0;
        }

        glViewport(0, 0, w, h);
        glClear(GL_COLOR_BUFFER_BIT);
        glUseProgram(program);
        glUniform2f(glGetUniformLocation(program, "uResolution"), float(w), float(h));
        glUniform1f(glGetUniformLocation(program, "uTime"), float(now));
        glUniform1f(glGetUniformLocation(program, "uFps"), fps);
        glUniform2f(glGetUniformLocation(program, "uMouse"), float(mx) * sx, float(h) - float(my) * sy);

        glUniform1i(cameraLoc, 0);
        glUniform2f(glGetUniformLocation(program, "uCameraSize"), float(cameraW), float(cameraH));
        glUniform1i(historyLoc, 1);
        glUniform1i(glGetUniformLocation(program, "uHistoryHead"), history.head());
        glUniform1i(glGetUniformLocation(program, "uHistoryCount"), history.count());
        glUniform1i(glGetUniformLocation(program, "uHistoryLayers"), FrameHistory::kLayers);

        if (ballLoc >= 0) {
            if (glfwGetKey(window, GLFW_KEY_SPACE) == GLFW_PRESS) ball.reset(float(w), float(h));
            ball.step(dt, float(w), float(h));
            uploadBall(program, ballLoc, ball);
        }

        glDrawArrays(GL_TRIANGLES, 0, 3);

        glfwSwapBuffers(window);
        glfwPollEvents();
    }

    glDeleteTextures(1, &cameraTex);
    glDeleteProgram(program);
    glDeleteVertexArrays(1, &vao);
    glfwDestroyWindow(window);
    glfwTerminate();
    return 0;
}
