using rhino_zmq_poc;
using Xunit;

namespace grasshopper_plugin.Tests
{
    public sealed class CommandHandlerAdapterTests
    {
        [Fact]
        public void Command_failures_carry_a_typed_error_code()
        {
            var error = Assert.Throws<CommandOperationException>(
                () => CommandOperationException.Fail("invalid input", "invalid_input"));
            Assert.Equal("invalid_input", error.Code);
            Assert.Equal("invalid input", error.Message);
        }
    }
}
