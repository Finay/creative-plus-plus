CXX      := clang++
CXXFLAGS := -std=c++20 -O2 -Wall -Wextra -Ivendor/glfw/include -DGL_SILENCE_DEPRECATION
LDFLAGS  := vendor/glfw/lib/libglfw3.a \
            -framework Cocoa -framework IOKit -framework CoreVideo \
            -framework QuartzCore -framework OpenGL \
            -framework AVFoundation -framework CoreMedia -framework Foundation \
            -Wl,-sectcreate,__TEXT,__info_plist,Info.plist

OBJ := $(patsubst src/%.cpp,build/%.o,$(wildcard src/*.cpp)) \
       $(patsubst src/%.mm,build/%.o,$(wildcard src/*.mm))
BIN := build/sketch

# Shader to open: make run SKETCH=shaders/donut.frag
SKETCH ?= shaders/ball.frag

.PHONY: all run clean

all: $(BIN)

$(BIN): $(OBJ) Info.plist
	$(CXX) $(OBJ) $(LDFLAGS) -o $@

build/%.o: src/%.cpp | build
	$(CXX) $(CXXFLAGS) -MMD -MP -c $< -o $@

build/%.o: src/%.mm | build
	$(CXX) $(CXXFLAGS) -fobjc-arc -MMD -MP -c $< -o $@

build:
	mkdir -p build

run: $(BIN)
	./$(BIN) $(SKETCH)

clean:
	rm -rf build

-include $(OBJ:.o=.d)
