#!/bin/bash
# holder.sh FIFO PID — keep a writer open on the console pipe while the director (PID) runs, so the short writes from
# say.sh never hand the director an end-of-file. Exits by itself once PID is gone. Started by direct.sh.
exec 3>"$1"
while kill -0 "$2" 2>/dev/null; do sleep 5; done
