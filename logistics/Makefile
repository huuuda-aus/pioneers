CXXFLAGS ?= -std=c++17 -Wall -Wextra -O2
logistics: sim.cc main.cc sim.h
	$(CXX) $(CXXFLAGS) sim.cc main.cc -o logistics
parity: sim.cc parity.cc sim.h
	$(CXX) $(CXXFLAGS) sim.cc parity.cc -o parity
parity.json: parity
	./parity > parity.json
test: logistics
	./logistics
clean:
	rm -f logistics parity
