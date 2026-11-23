package load

import (
	"context"
	"errors"
	"runtime"
	"testing"
)

func TestParsers(t *testing.T) {
	out := `| |   "PerformanceStatistics" = {"Device Utilization %"=27,"Renderer Utilization %"=20}
| |   "PerformanceStatistics" = {"Device Utilization %"=41}`
	if v := ParseIoreg(out); v == nil || *v != 41 {
		t.Fatalf("ioreg %v", v)
	}
	if ParseIoreg("nothing") != nil {
		t.Fatal("no gpu")
	}
	if v := ParseNvidia("12\n 55 \nx\n"); v == nil || *v != 55 {
		t.Fatalf("nvidia %v", v)
	}
	if ParseNvidia("") != nil {
		t.Fatal("empty")
	}
}

func TestMeasure(t *testing.T) {
	fake := func(ctx context.Context, name string, args ...string) ([]byte, error) {
		if name == "ioreg" {
			return []byte(`"Device Utilization %"=9`), nil
		}
		return nil, errors.New("no nvidia")
	}
	l := Measure(context.Background(), t.TempDir()+"/not/yet", fake)
	if l.RAMTotal <= 0 || l.DiskTotal <= 0 || l.CPU < 0 || l.CPU > 100 {
		t.Fatalf("load %+v", l)
	}
	if runtime.GOOS == "darwin" && (l.GPU == nil || *l.GPU != 9) {
		t.Fatalf("gpu %v", l.GPU)
	}
	if runtime.GOOS == "linux" && l.GPU != nil {
		t.Fatalf("gpu without nvidia: %v", *l.GPU)
	}
}

func TestSampler(t *testing.T) {
	s := &Sampler{}
	if s.Last() != nil {
		t.Fatal("no sample yet")
	}
	for i := 0; i < History+5; i++ {
		s.Put(protocolLoad(float64(i)))
	}
	if s.Last().CPU != float64(History+4) || len(s.History()) != History || s.History()[0].CPU != 5 {
		t.Fatalf("history %v", s.History()[0])
	}
}
