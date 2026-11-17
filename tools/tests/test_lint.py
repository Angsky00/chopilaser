import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from gcode_lint import lint

def codes(t, **k):
    e, w = lint(t, k.pop('max_s', 1000), **k)
    return [c for _, c, _ in e], [c for _, c, _ in w]

OK = "G21 G90\nM5 S0\nG0 X10 Y10\nM3 S500\nG1 X20 F1200\nG1 Y20\nM5\nG0 X0 Y0\nM5 S0\n"

def test_ok(): assert codes(OK) == ([], [])
def test_g0_on(): assert 'G0_LASER_ON' in codes("M3 S500\nG1 X1 F100\nG0 X5\nM5\n")[0]
def test_g0_s0_ok(): assert codes("M3 S0\nG0 X5\nS300\nG1 X6 F100\nS0\nM5\n")[0] == []
def test_g0_laser_mode_warn():
    e, w = codes("M3 S500\nG1 X1 F100\nG0 X5\nM5\n", laser_mode=True)
    assert e == [] and 'G0_LASER_ON' in w
def test_modal_g0(): assert 'G0_LASER_ON' in codes("G0\nM3 S100\nX5\nM5\n")[0]
def test_s_over(): assert 'S_OVER_MAX' in codes("M3 S1001\nM5\n")[0]
def test_s_equal_ok(): assert codes("M3 S1000\nG1 X1 F100\nM5\n")[0] == []
def test_smoothie_scale(): assert 'S_OVER_MAX' in codes("M3 S1.5\nM5\n", max_s=1)[0]
def test_no_m5(): assert 'NO_M5_END' in codes("M3 S100\nG1 X1 F100\n")[0]
def test_m4_no_m5(): assert 'NO_M5_END' in codes("M4 S100\nG1 X1 F100\n")[0]
def test_no_feed(): assert 'NO_FEED' in codes("M3 S100\nG1 X1\nM5\n")[0]
def test_comments(): assert codes("(M3 S999)\n; M3 S999\nG0 X1 ; comentario\nM5\n", max_s=10)[0] == []
def test_compact(): assert 'G0_LASER_ON' in codes("M3S500\nG1X1F100\nG0X5Y5\nM5\n")[0]
def test_bed(): assert 'OUT_OF_BED' in codes("G0 X500 Y0\nM5\n", bed=(400, 400))[0]
def test_relative_bed(): assert 'OUT_OF_BED' in codes("G91\nG0 X300\nG0 X300\nM5\n", bed=(400, 400))[0]
def test_parse(): assert 'PARSE' in codes("G1 X1 F100 ¿?\nM5\n")[0]
