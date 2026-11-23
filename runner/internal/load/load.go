// Package load measures the utilization of the machine (spec 8.6) without cgo: CPU, RAM and disk through gopsutil
// (purego on macOS, /proc on Linux), the GPU through `ioreg` (Apple Silicon, IOAccelerator "Device Utilization %") or
// `nvidia-smi`, else nil ("not available").
package load

import (
	"context"
	"math"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/disk"
	"github.com/shirou/gopsutil/v4/mem"

	"github.com/baeroe/werkbuch/runner/internal/protocol"
	"github.com/baeroe/werkbuch/runner/internal/sysexec"
)

// Interval is how often the sampler measures (spec 8.6).
const Interval = 5 * time.Second

// History is how many samples the sampler keeps for the TUI (the last minutes).
const History = 60

const gb = 1 << 30

// Measure takes one sample: CPU over one second, RAM, the disk holding dir, the GPU.
func Measure(ctx context.Context, dir string, run sysexec.Func) protocol.Load {
	var l protocol.Load
	if p, err := cpu.PercentWithContext(ctx, time.Second, false); err == nil && len(p) > 0 {
		l.CPU = round(p[0])
	}
	if m, err := mem.VirtualMemoryWithContext(ctx); err == nil {
		l.RAMUsed, l.RAMTotal = round(float64(m.Used)/gb), round(float64(m.Total)/gb)
	}
	if d, err := disk.UsageWithContext(ctx, existing(dir)); err == nil {
		l.DiskFree, l.DiskTotal = round(float64(d.Free)/gb), round(float64(d.Total)/gb)
	}
	l.GPU = GPU(ctx, run)
	return l
}

func round(v float64) float64 { return math.Round(math.Max(0, v)*10) / 10 }

var ioregUtil = regexp.MustCompile(`"Device Utilization %"\s*=\s*(\d+)`)

// GPU reads the utilization of the GPU in percent, nil where the system gives none without root.
func GPU(ctx context.Context, run sysexec.Func) *float64 {
	if runtime.GOOS == "darwin" {
		out, err := run(ctx, "ioreg", "-r", "-d", "1", "-w", "0", "-c", "IOAccelerator")
		if err != nil {
			return nil
		}
		return ParseIoreg(string(out))
	}
	out, err := run(ctx, "nvidia-smi", "--query-gpu=utilization.gpu", "--format=csv,noheader,nounits")
	if err != nil {
		return nil
	}
	return ParseNvidia(string(out))
}

// ParseIoreg takes the highest "Device Utilization %" of the accelerators.
func ParseIoreg(out string) *float64 {
	var best *float64
	for _, m := range ioregUtil.FindAllStringSubmatch(out, -1) {
		v, err := strconv.ParseFloat(m[1], 64)
		if err == nil && v <= 100 && (best == nil || v > *best) {
			b := v
			best = &b
		}
	}
	return best
}

// ParseNvidia takes the highest utilization of the lines of nvidia-smi.
func ParseNvidia(out string) *float64 {
	var best *float64
	for _, line := range strings.Split(out, "\n") {
		v, err := strconv.ParseFloat(strings.TrimSpace(line), 64)
		if err == nil && v >= 0 && v <= 100 && (best == nil || v > *best) {
			b := v
			best = &b
		}
	}
	return best
}

// Sampler measures every Interval and keeps the last samples.
type Sampler struct {
	Dir  string
	Run  sysexec.Func
	mu   sync.RWMutex
	last *protocol.Load
	hist []protocol.Load
}

// Start measures until ctx ends.
func (s *Sampler) Start(ctx context.Context) {
	go func() {
		for {
			l := Measure(ctx, s.Dir, s.Run)
			s.Put(l)
			select {
			case <-ctx.Done():
				return
			case <-time.After(Interval):
			}
		}
	}()
}

// Put records a sample (also for tests).
func (s *Sampler) Put(l protocol.Load) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.last = &l
	s.hist = append(s.hist, l)
	if len(s.hist) > History {
		s.hist = s.hist[len(s.hist)-History:]
	}
}

// Last is the latest sample, nil before the first.
func (s *Sampler) Last() *protocol.Load {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.last == nil {
		return nil
	}
	l := *s.last
	return &l
}

// History is the samples of the last minutes, oldest first.
func (s *Sampler) History() []protocol.Load {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return append([]protocol.Load(nil), s.hist...)
}

// existing walks up to a folder that exists (the data folder may not yet).
func existing(dir string) string {
	for dir != "" && dir != "/" {
		if ok, _ := disk.UsageWithContext(context.Background(), dir); ok != nil {
			return dir
		}
		i := strings.LastIndex(dir, "/")
		if i <= 0 {
			break
		}
		dir = dir[:i]
	}
	return "/"
}
