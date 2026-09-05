## General
- change the command from ```_Hopper``` to be ```HopperCode```

## Q1
- let's remove node from the bundle, node should be prerequisites. do document
this inc the minmimum supoprted version. Do create separate path for win and mac and per cpu to  avoid bloating zeromq package to be 20mb
- why are we sending test, dumb script, stale output ietc in the bundle...?
  do not include it


## Q2 
- move netmq thread/ socket to be its own thread
- Main-thread shutdown can stall Rhino seems real, apply the fix as u sugggest
- If HopperCode is run again, it should just display alredy running  or
  something. we also need:
  - HopperCodeStop to stop the currently running instance of hopper
  - HopperCodeStatus to check the status of the currently running instance
  - HopperCodeRestart to restart the currently running instance

## Q3
- how are you impleneitng getRuntimeStatus? the agent should be able to check if
grasshopper is running and if it is not , it should init the grasshopper. 
- let's do your recomended queue model

## Q4
your recomended shape sounds good






